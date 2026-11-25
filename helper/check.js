'use strict';
// One-screen check of a PC: is K Downloader installed, running, starting with Windows, registered in Claude Code,
// and is the Chrome extension in place? Run with check.cmd. Exit code 1 when something needs attention.

const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const PROGRAM = path.join(LOCAL, 'Programs', 'K Downloader');
const DATA = path.join(LOCAL, 'K Downloader');
const PORT = 17653;
const rows = [];
let problems = 0;
const row = (name, ok, detail, fix) => { rows.push({ name, ok, detail, fix }); if (!ok) problems += 1; };

function get(url, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers, timeout: 3000 }, (res) => { let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(s) }); } catch { resolve({ status: res.statusCode, data: {} }); } }); });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

(async () => {
  const exe = path.join(PROGRAM, 'K Downloader.exe');
  const installed = fs.existsSync(exe);
  let version = '';
  try { version = JSON.parse(fs.readFileSync(path.join(PROGRAM, 'resources', 'app.asar.unpacked', 'package.json'), 'utf8')).version; } catch { /* asar packed */ }
  if (!version) { const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item '${exe.replace(/'/g, "''")}').VersionInfo.FileVersion`], { encoding: 'utf8' }); version = (r.stdout || '').trim(); }
  row('App installed', installed, installed ? `${PROGRAM} (v${version || '?'})` : 'not found', 'Run "K Downloader Setup x.y.z.exe" from the dist folder.');

  const health = await get(`http://127.0.0.1:${PORT}/health`);
  row('Helper answering', Boolean(health && health.data.ok), health ? `helper ${health.data.version}` : 'no answer on port 17653', 'Open K Downloader from the Start menu (it starts the helper), or run check again in a minute.');

  const running = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq K Downloader.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  const appUp = /K Downloader\.exe/.test(running.stdout || '');
  row('App running', appUp, appUp ? 'in the tray' : 'not running', 'Open K Downloader from the Start menu.');

  const task = spawnSync('schtasks.exe', ['/Query', '/TN', 'K Downloader', '/XML'], { encoding: 'utf8' });
  const taskOk = task.status === 0 && /RestartOnFailure/.test(task.stdout);
  row('Starts with Windows', taskOk, taskOk ? 'Task Scheduler task "K Downloader" with restart on failure' : 'task missing', 'Open K Downloader once; it registers the task. Check "Start with Windows" in Settings.');

  let mcp = false; let mcpDetail = '';
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    const s = cfg.mcpServers && cfg.mcpServers['k-downloader'];
    mcp = Boolean(s && s.args && s.args[0] && fs.existsSync(s.args[0]));
    mcpDetail = s ? s.args[0] : 'not in ~/.claude.json';
  } catch { mcpDetail = 'Claude Code not set up on this PC (no ~/.claude.json)'; }
  row('Claude Code registered', mcp, mcpDetail, 'Settings > Claude Code > Register, then restart Claude Code.');

  const token = (() => { try { return fs.readFileSync(path.join(DATA, 'pairing-code.txt'), 'utf8').trim(); } catch { return ''; } })();
  const cookies = token ? await get(`http://127.0.0.1:${PORT}/cookies`, { 'X-KD-Token': token }) : null;
  row('Pairing code', Boolean(token), token ? `${DATA}\\pairing-code.txt` : 'missing', 'Open K Downloader once; the helper writes it.');
  if (cookies) row('Browser logins', true, (cookies.data.hosts || []).length ? `signed in: ${cookies.data.hosts.filter((h) => /pinterest|google|youtube|facebook|instagram/.test(h)).slice(0, 5).join(', ') || cookies.data.hosts.length + ' sites'}` : 'none yet', 'Optional: sign in to Pinterest/Google on the Browser page for full results.');

  const ext = path.join(PROGRAM, 'resources', 'extension', 'manifest.json');
  row('Chrome extension files', fs.existsSync(ext), fs.existsSync(ext) ? path.dirname(ext) : 'missing', 'Reinstall the app.');
  // Chrome keeps unpacked extensions (with their folder path) in "Secure Preferences" of each profile.
  const profiles = path.join(LOCAL, 'Google', 'Chrome', 'User Data');
  let loaded = null;
  try {
    const needle = path.dirname(ext).replace(/\\/g, '\\\\');
    for (const name of fs.readdirSync(profiles).filter((n) => n === 'Default' || /^Profile \d+$/.test(n))) {
      for (const file of ['Secure Preferences', 'Preferences']) {
        try { const prefs = fs.readFileSync(path.join(profiles, name, file), 'utf8'); if (prefs.includes(needle) || /"path":"[^"]*\\\\extension"/.test(prefs) && prefs.includes('K Downloader')) loaded = true; } catch { /* missing */ }
      }
      if (loaded === null) loaded = false;
    }
  } catch { /* no chrome */ }
  if (loaded !== null) row('Extension loaded in Chrome', loaded, loaded ? 'found in the Chrome profile' : 'not loaded', 'chrome://extensions > Developer mode > Load unpacked > the folder above.');

  const projects = token ? await get(`http://127.0.0.1:${PORT}/projects`, { 'X-KD-Token': token }) : null;
  if (projects) row('Projects folder', true, projects.data.root ? `${projects.data.root}${projects.data.current ? ` (active: ${projects.data.current.name})` : ''}` : 'not set (downloads go to the Downloads folder)', '');
  const sources = token ? await get(`http://127.0.0.1:${PORT}/sources/health`, { 'X-KD-Token': token }) : null;
  if (sources) {
    const list = Object.values(sources.data.sources || {});
    const broken = list.filter((s) => s.broken).map((s) => s.name);
    row('Search sources', broken.length === 0, list.length ? `${list.filter((s) => s.ok).length}/${list.length} answered${broken.length ? `, broken: ${broken.join(', ')}` : ''}` : 'not checked yet', 'Settings > Source health > Check now.');
  }
  const gpu = token ? await get(`http://127.0.0.1:${PORT}/gpu`, { 'X-KD-Token': token }) : null;
  if (gpu && gpu.data.nvidia) row('GPU speech engine', Boolean(gpu.data.installed), gpu.data.installed ? `installed (${gpu.data.nvidia.name})` : `${gpu.data.nvidia.name} found, engine not installed`, 'Optional: Settings > GPU speech engine > Install.');

  const width = Math.max(...rows.map((r) => r.name.length)) + 2;
  console.log(`K Downloader check on ${os.hostname()} (${os.userInfo().username})\n`);
  for (const r of rows) {
    console.log(`${r.ok ? 'OK  ' : 'FIX '} ${r.name.padEnd(width)} ${r.detail}`);
    if (!r.ok && r.fix) console.log(`${''.padEnd(width + 5)}-> ${r.fix}`);
  }
  console.log(`\n${problems ? `${problems} item(s) need attention.` : 'Everything is in place.'}`);
  process.exit(problems ? 1 : 0);
})();
