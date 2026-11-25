'use strict';
// K Downloader desktop app: a tray icon, a window, and the helper running as a child process.
// The renderer never touches the network itself; every helper call goes through here with the pairing code.

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, nativeImage, clipboard } = require('electron');
const { spawn, execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const createBrowser = require('./browser.js');
const createScraper = require('./scraper.js');
const createUpdater = require('./updater.js');

const PORT = 17653;
const DEV = process.argv.includes('--dev');
const START_HIDDEN = process.argv.includes('--hidden');
const RESOURCES = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, 'payload');
const BIN = path.join(RESOURCES, 'bin');
const HELPER = path.join(RESOURCES, 'helper', 'server.js');
const MCP = path.join(RESOURCES, 'helper', 'mcp.js');
const NODE = path.join(BIN, 'node.exe');
const DATA = path.join(process.env.LOCALAPPDATA || os.homedir(), 'K Downloader');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const TOKEN_FILE = path.join(DATA, 'pairing-code.txt');
const ICON = path.join(__dirname, 'icon.ico');
const SCRIPT_URL = `http://127.0.0.1:${PORT}/kareem-downloader.user.js`;

let tray = null;
let win = null;
let helper = null;
let helperRestarts = 0;
let quitting = false;
let browser = null;
let scraper = null;
let updater = null;

/* ---------- settings ---------- */

// cache: where partial downloads, speech models and the GPU engine live (empty = the data folder).
// projects: an optional root of project folders; downloads can be aimed at a project instead of Downloads.
const defaults = () => ({ out: path.join(os.homedir(), 'Downloads', 'K Downloader'), startWithWindows: true, firstRunDone: false, updateSource: '', autoInstall: true, cache: '', projects: '', setupDone: false });
function loadSettings() {
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return defaults();
  }
}
let settings = loadSettings();
function saveSettings(patch) {
  settings = { ...settings, ...patch };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

const token = () => {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
};

/* ---------- helper process ---------- */

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// Older installs ran the helper from a Startup shortcut; that copy would keep the port and serve old code.
function stopForeignHelpers() {
  return new Promise((resolve) => {
    const script = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*helper\\server.js*' -and $_.ExecutablePath -ne '${NODE.replace(/'/g, "''")}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, () => resolve());
  });
}

function startHelper() {
  if (helper || quitting) return;
  // The sign-in task can start us without a usable TEMP; the helper and its tools must never fall back to System32.
  const temp = process.env.TEMP && fs.existsSync(process.env.TEMP) ? process.env.TEMP : app.getPath('temp');
  helper = spawn(NODE, [HELPER], {
    env: { ...process.env, TEMP: temp, TMP: temp, KD_OUT: settings.out, KD_PORT: String(PORT), KD_CACHE: settings.cache || '', KD_PROJECTS: settings.projects || '' },
    cwd: path.dirname(NODE), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  helper.stdout.on('data', (d) => { if (DEV) process.stdout.write(`[helper] ${d}`); });
  helper.stderr.on('data', (d) => { if (DEV) process.stderr.write(`[helper] ${d}`); });
  helper.on('exit', (code) => {
    helper = null;
    logLine(`helper exited with ${code}${quitting ? ' (quitting)' : ''}`);
    if (quitting) return;
    // A busy port means another helper answered; otherwise come back, slower each time.
    helperRestarts += 1;
    setTimeout(async () => {
      if (await health()) return;
      startHelper();
    }, Math.min(30000, 1000 * helperRestarts));
  });
}

async function restartHelper() {
  if (helper) {
    const proc = helper;
    helper = null;
    quitting = true;
    proc.kill();
    await new Promise((r) => proc.once('exit', r));
    quitting = false;
  }
  helperRestarts = 0;
  startHelper();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await health()) break;
  }
}

/* ---------- helper API for the renderer ---------- */

function api(method, route, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: route, method, timeout: route.startsWith('/images/search') ? 240000 : 70000,
      headers: { 'Content-Type': 'application/json', 'X-KD-Token': token(), 'X-KD-Paths': '1', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* status tells */ }
        resolve({ status: res.statusCode, data: json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, data: { error: e.code === 'ECONNREFUSED' ? 'offline' : e.message } }));
    if (data) req.write(data);
    req.end();
  });
}

/* ---------- Claude Code registration ---------- */

// Registers the MCP server wherever Claude lives on this PC, every time the app starts, so a Claude installed
// later is picked up too: Claude Code (user scope, ~/.claude.json) and the Claude desktop app
// (%APPDATA%\Claude\claude_desktop_config.json). ~/.claude.json is created when missing, so the entry is
// already there the first time Claude Code runs.
function registerIn(file, create, key) {
  try {
    if (!fs.existsSync(file)) { if (!create) return 'absent'; fs.mkdirSync(path.dirname(file), { recursive: true }); }
    const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8') || '{}') : {};
    cfg[key] = cfg[key] || {};
    const current = cfg[key]['k-downloader'];
    if (current && current.command === NODE && current.args && current.args[0] === MCP) return 'ok';
    cfg[key]['k-downloader'] = { type: 'stdio', command: NODE, args: [MCP], env: {} };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    return 'ok';
  } catch {
    return 'error';
  }
}
function registerMcp() {
  const code = registerIn(path.join(os.homedir(), '.claude.json'), true, 'mcpServers');
  const desktopFile = path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json');
  const desktop = registerIn(desktopFile, fs.existsSync(path.dirname(desktopFile)), 'mcpServers');
  return code === 'ok' || desktop === 'ok';
}
// What the setup guide shows about Claude on this PC.
function claudeStatus() {
  const codeInstalled = fs.existsSync(path.join(os.homedir(), '.claude')) || fs.existsSync(path.join(os.homedir(), '.claude.json'));
  const desktopInstalled = fs.existsSync(path.join(app.getPath('appData'), 'Claude'));
  const has = (file) => { try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); return Boolean(c.mcpServers && c.mcpServers['k-downloader']); } catch { return false; } };
  return { codeInstalled, desktopInstalled, codeRegistered: has(path.join(os.homedir(), '.claude.json')), desktopRegistered: has(path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json')) };
}
// Opens a browser straight on its extensions page, so loading the extension is two clicks.
function openExtensionsPage(which) {
  const candidates = which === 'edge'
    ? [path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
    : [path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')];
  const exe = candidates.find((p) => p && fs.existsSync(p));
  if (!exe) return false;
  spawn(exe, [which === 'edge' ? 'edge://extensions/' : 'chrome://extensions/'], { detached: true, stdio: 'ignore' }).unref();
  clipboard.writeText(path.join(RESOURCES, 'extension'));
  return true;
}

/* ---------- autostart and first run ---------- */

// Startup is a Task Scheduler task rather than a plain login item: it starts the app hidden 15 s after sign-in and
// starts it again, up to three times, if it ever crashes. Test builds (win-unpacked) never register themselves.
const TASK_NAME = 'K Downloader';
const TASK_XML = path.join(DATA, 'startup-task.xml');
function taskXml() {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const user = `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Starts K Downloader hidden at sign-in and starts it again if it stops.</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>${esc(user)}</UserId><Delay>PT15S</Delay>
      <Repetition><Interval>PT10M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle><WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>7</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(process.execPath)}</Command><Arguments>--hidden</Arguments><WorkingDirectory>${esc(path.dirname(process.execPath))}</WorkingDirectory></Exec></Actions>
</Task>`;
}
function schtasks(args) {
  return new Promise((resolve) => execFile('schtasks.exe', args, { windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` })));
}
async function applyAutostart() {
  // Older versions used a login item; the task replaces it.
  app.setLoginItemSettings({ openAtLogin: false, args: ['--hidden'] });
  const installed = app.isPackaged && !/win-unpacked/i.test(process.execPath);
  if (!installed) return;
  if (settings.startWithWindows) {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(TASK_XML, `﻿${taskXml()}`, 'utf16le');
    const r = await schtasks(['/Create', '/TN', TASK_NAME, '/XML', TASK_XML, '/F']);
    if (!r.ok && DEV) console.error('task:', r.out);
  } else {
    await schtasks(['/Delete', '/TN', TASK_NAME, '/F']);
  }
}

// Every 45 s the helper has to answer; a hung helper is restarted, a missing one started.
let helperSilent = 0;
function watchHelper() {
  setInterval(async () => {
    if (quitting) return;
    if (await health()) { helperSilent = 0; return; }
    helperSilent += 1;
    if (!helper) { startHelper(); return; }
    if (helperSilent >= 2) {
      helperSilent = 0;
      const proc = helper;
      helper = null;
      proc.kill();
    }
  }, 45000).unref();
}

function firstRun() {
  // The script-only install left a Startup shortcut; the app owns startup now.
  const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Kareem Downloader.lnk');
  try { fs.rmSync(link, { force: true }); } catch { /* not there */ }
  saveSettings({ firstRunDone: true });
}

/* ---------- window and tray ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1040, height: 720, minWidth: 820, minHeight: 540, show: false,
    backgroundColor: '#17181b', icon: ICON, title: 'K Downloader', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  browser = createBrowser({
    win, api,
    onState: (state) => { if (win && !win.isDestroyed()) win.webContents.send('kd:browserState', state); },
    onCapture: ({ url, name, referer }) => {
      api('POST', '/download', { url, title: name || url, option: { kind: 'file', name, referer } }).then(() => { if (win && !win.isDestroyed()) win.webContents.send('kd:toast', `Downloading ${name || url}`); });
    },
  });
  scraper = createScraper({ onVerify: (site) => { if (win && !win.isDestroyed()) win.webContents.send('kd:toast', `${site} wants to check you are human. Answer in the window that opened.`); } });
  // The helper hands over Claude's browser requests and image searches; the app answers them here.
  setInterval(async () => {
    const { status, data } = await api('GET', '/app/commands');
    if (status !== 200 || !data.commands) return;
    // Each command runs on its own, so a slow image site never holds up the others.
    for (const c of data.commands) {
      (c.type.startsWith('images.') ? scraper : browser).run(c.type, c.params || {})
        .then((result) => api('POST', `/app/commands/${c.id}/result`, { result }), (e) => api('POST', `/app/commands/${c.id}/result`, { error: e.message }));
    }
  }, 700);
  win.once('ready-to-show', () => {
    if (START_HIDDEN) return;
    win.show();
    // Right after installing, the setup guide comes first.
    if (!settings.setupDone) win.webContents.send('kd:navigate', 'setup');
  });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow(page) {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (page) win.webContents.send('kd:navigate', page);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip('K Downloader by Kareem Waheed');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open K Downloader', click: () => showWindow() },
    { label: 'Paste links', click: () => showWindow('links') },
    { label: 'Open downloads folder', click: () => { fs.mkdirSync(settings.out, { recursive: true }); shell.openPath(settings.out); } },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: Boolean(settings.startWithWindows), click: (item) => { saveSettings({ startWithWindows: item.checked }); applyAutostart(); } },
    ...(updater && updater.state().ready ? [{ label: `Install update ${updater.state().available.version}`, click: () => { quitting = true; updater.install(); app.quit(); } }] : []),
    { type: 'separator' },
    { label: 'Quit', click: () => { logLine('quit from tray menu'); quitting = true; app.quit(); } },
  ]);
  createTrayMenu = () => tray.setContextMenu(menu());
  createTrayMenu();
  tray.on('click', () => showWindow());
  tray.on('right-click', createTrayMenu);
}
let createTrayMenu = () => {};

/* ---------- ipc ---------- */

ipcMain.handle('kd:api', (e, method, route, body) => api(method, route, body));
ipcMain.handle('kd:settings', () => ({ ...settings, version: app.getVersion(), data: DATA, cacheDir: settings.cache || DATA, scriptUrl: SCRIPT_URL, pairingCode: token(), extensionDir: path.join(RESOURCES, 'extension') }));
ipcMain.handle('kd:setStartup', async (e, on) => { saveSettings({ startWithWindows: Boolean(on) }); await applyAutostart(); return settings.startWithWindows; });
// which: out (downloads), cache (partials, models, engines) or projects (root of project folders). Each change restarts the helper.
const FOLDER_TITLES = { out: 'Where should downloads go?', cache: 'Where should the cache live? (partial downloads, speech models, engines)', projects: 'Which folder holds your projects?' };
ipcMain.handle('kd:chooseFolder', async (e, which = 'out') => {
  const key = FOLDER_TITLES[which] ? which : 'out';
  const r = await dialog.showOpenDialog(win, { title: FOLDER_TITLES[key], defaultPath: settings[key] || settings.out, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return settings[key] || '';
  saveSettings({ [key]: r.filePaths[0] });
  await restartHelper();
  return settings[key];
});
ipcMain.handle('kd:clearFolder', async (e, which) => {
  if (!['cache', 'projects'].includes(which)) return '';
  saveSettings({ [which]: '' });
  await restartHelper();
  return '';
});
ipcMain.handle('kd:openPath', (e, p) => (p ? shell.openPath(p) : shell.openPath(settings.out)));
ipcMain.handle('kd:showItem', (e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); else shell.openPath(settings.out); });
ipcMain.handle('kd:openExternal', (e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
ipcMain.handle('kd:copy', (e, text) => clipboard.writeText(String(text || '')));
ipcMain.handle('kd:readClipboard', () => clipboard.readText());
ipcMain.handle('kd:registerMcp', () => registerMcp());
ipcMain.handle('kd:claudeStatus', () => ({ ...claudeStatus(), registered: registerMcp() }));
ipcMain.handle('kd:openExtensionsPage', (e, which) => openExtensionsPage(which === 'edge' ? 'edge' : 'chrome'));
ipcMain.handle('kd:setupDone', () => { saveSettings({ setupDone: true }); return true; });
ipcMain.handle('kd:restartHelper', () => restartHelper());
ipcMain.handle('kd:update', async (e, action, value) => {
  if (action === 'setSource') { saveSettings({ updateSource: String(value || '').trim() }); await updater.check(); }
  if (action === 'autoInstall') saveSettings({ autoInstall: Boolean(value) });
  if (action === 'check') await updater.check();
  if (action === 'install' && updater.install()) { quitting = true; app.quit(); }
  return { ...updater.state(), autoInstall: settings.autoInstall };
});
ipcMain.handle('kd:browser', (e, action, arg) => (browser ? browser.command(action, arg) : null));
ipcMain.handle('kd:browserShow', (e, on) => { if (browser) browser.show(Boolean(on)); });
ipcMain.handle('kd:browserBounds', (e, b) => { if (browser && b) browser.setBounds(b); });

/* ---------- lifecycle ---------- */

// A short log of starts, exits and helper restarts, so "it was not running this morning" has an answer.
function logLine(text) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const file = path.join(DATA, 'app.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.renameSync(file, path.join(DATA, 'app.previous.log'));
    fs.appendFileSync(file, `${new Date().toISOString()} ${text}${os.EOL}`);
  } catch { /* the log never stops the app */ }
}

if (!app.requestSingleInstanceLock()) {
  // The sign-in task also fires every 10 minutes as a safety net; when the app is already up, this copy leaves.
  app.quit();
} else {
  logLine(`start v${app.getVersion()} ${process.argv.slice(1).join(' ')}`);
  process.on('uncaughtException', (e) => { logLine(`uncaught: ${e && e.stack || e}`); });
  process.on('unhandledRejection', (e) => { logLine(`unhandled: ${e && e.stack || e}`); });
  app.on('will-quit', () => logLine('quit'));
  app.on('render-process-gone', (e, wc, d) => logLine(`renderer gone: ${d.reason}`));
  app.on('child-process-gone', (e, d) => logLine(`child gone: ${d.type} ${d.reason}`));
  app.on('second-instance', () => showWindow());
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.kareemwaheed.kdownloader');
    fs.mkdirSync(DATA, { recursive: true });
    if (!settings.firstRunDone) firstRun();
    applyAutostart();
    registerMcp();
    await stopForeignHelpers();
    if (!(await health())) startHelper();
    watchHelper();
    updater = createUpdater({ getSource: () => settings.updateSource, dataDir: DATA, onChange: (st) => { if (win && !win.isDestroyed()) win.webContents.send('kd:update', { ...st, autoInstall: settings.autoInstall }); if (tray) createTrayMenu(); } });
    createTray();
    createWindow();
    // At sign-in the app is hidden, so an installer already checked and waiting can run before anyone notices.
    if (START_HIDDEN && settings.autoInstall) {
      await updater.check();
      if (updater.state().ready) { logLine(`quit to install update ${updater.state().available && updater.state().available.version}`); quitting = true; updater.install(); app.quit(); return; }
    }
    updater.schedule();
  });
  app.on('before-quit', () => {
    quitting = true;
    if (helper) helper.kill();
  });
  app.on('window-all-closed', () => { /* stays in the tray */ });
}
