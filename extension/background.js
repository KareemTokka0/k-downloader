'use strict';
// Catches downloads Chrome is about to save and hands them to the local K Downloader helper.

const HELPER = 'http://127.0.0.1:17653';
const MEDIA_SITES = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|fb\.watch|instagram\.com|tiktok\.com|x\.com|twitter\.com|vimeo\.com|dailymotion\.com|twitch\.tv|soundcloud\.com|reddit\.com|linkedin\.com|pinterest\.[a-z.]+)$/i;
const FILE_EXT = /\.(zip|rar|7z|tar|gz|exe|msi|dmg|iso|pdf|docx?|xlsx?|pptx?|mp4|mkv|mov|avi|webm|mp3|wav|flac|m4a|aac|jpe?g|png|gif|webp|svg|psd|ai|prproj|aep|mogrt|ttf|otf|apk|bin)(\?|#|$)/i;

// Below this size a download manager adds nothing, and generated files (invoices, CSV reports) rarely come twice.
const BIG_FILE_KB = 20 * 1024;
const SENSITIVE_SITES =/^https?:\/\/(accounts?|myaccount|login|signin|auth|sso|id|passwords?|security|vault)\.[^/]+\//i;
const SENSITIVE_FILES = /backup.?codes|recovery.?(codes|key)|passwords?|credentials|2fa|two.?factor|\.(key|pem|p12|pfx|kdbx)$/i;
// Hosting control panels: cPanel, WHM and webmail ports, session paths and phpMyAdmin. Their exports are forms
// and their files are backups; Chrome keeps them.
const PANEL_SITES = /^https?:\/\/[^/]+:(2082|2083|2086|2087|2095|2096)\/|\/cpsess\d+\/|\/(phpmyadmin|phpMyAdmin|pma|roundcube|webmail|whm|cpanel)(\/|\?|$)/i;

const state = () => chrome.storage.local.get({ token: '', enabled: true, minKB: 0, recent: [] });

/* ---------- which request started a download ---------- */

// Chrome's DownloadItem has no method or response headers, so the requests of the last minute are remembered:
// a download that came out of a POST (an export form) can never be fetched again and stays in Chrome, and
// Chrome's Content-Type / Content-Disposition go to the helper so it can tell a real file from an error page.
const requests = new Map();
const REQUEST_TTL = 60 * 1000;
function rememberRequest(url, patch) {
  const now = Date.now();
  for (const [k, v] of requests) if (now - v.at > REQUEST_TTL) requests.delete(k);
  requests.set(url, { at: now, ...(requests.get(url) || {}), ...patch });
}
const REQUEST_FILTER = { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame', 'xmlhttprequest', 'other'] };
chrome.webRequest.onBeforeRequest.addListener((d) => { rememberRequest(d.url, { method: d.method, tabId: d.tabId }); }, REQUEST_FILTER);
chrome.webRequest.onHeadersReceived.addListener((d) => {
  const header = (name) => { const h = (d.responseHeaders || []).find((x) => x.name.toLowerCase() === name); return h ? String(h.value || '') : ''; };
  rememberRequest(d.url, { contentType: header('content-type'), disposition: header('content-disposition'), contentLength: Number(header('content-length')) || 0, status: d.statusCode });
}, REQUEST_FILTER, ['responseHeaders']);
// What Chrome saw for this download: the final URL first, then the one the click asked for (redirects).
function requestFor(item) {
  for (const u of [item.finalUrl, item.url, item.referrer]) {
    const r = u && requests.get(u);
    if (r) return r;
  }
  return null;
}

async function helper(route, body) {
  const { token } = await state();
  if (!token) throw Object.assign(new Error('not paired'), { code: 'pair' });
  let res;
  try {
    res = await fetch(HELPER + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KD-Token': token }, body: JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('offline'), { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw Object.assign(new Error('wrong code'), { code: 'pair' });
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { code: data.code || 'error' });
  return data;
}

async function remember(entry) {
  const { recent } = await state();
  await chrome.storage.local.set({ recent: [entry, ...recent].slice(0, 20) });
}

function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title, message, silent: true });
}

async function helperGet(route) {
  const { token } = await state();
  const res = await fetch(HELPER + route, { headers: { 'X-KD-Token': token } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// The cookies Chrome would have sent for this link, so files that only exist behind a login (cPanel, Drive,
// a client's intranet) download the same way they do in the browser. They go only to the helper on this PC.
async function cookieHeader(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ').slice(0, 16000);
  } catch { return ''; }
}

// What to ask the helper for: a media page goes through the video engine, a plain link is a file.
async function optionFor(url, name, referer, expect) {
  let host = '';
  try { host = new URL(url).hostname; } catch { /* not a link */ }
  if (MEDIA_SITES.test(host) && !FILE_EXT.test(url)) return { body: { url, title: url, option: { kind: 'video', height: 2160 }, fallbackToFile: true } };
  const cookie = await cookieHeader(url);
  return { body: { url, title: name || url, option: { kind: 'file', name: name || '', referer: referer || '', ...(cookie ? { cookie } : {}), ...(expect ? { expect } : {}) } } };
}

async function send(url, name, referer, expect) {
  const { body } = await optionFor(url, name, referer, expect);
  try {
    const job = await helper('/download', body);
    await remember({ at: Date.now(), url, title: name || url, label: job.label, ok: true });
    return job;
  } catch (e) {
    const text = e.code === 'pair' ? 'Open the extension and press Connect first.' : e.code === 'offline' ? 'K Downloader is not running on this PC.' : e.message;
    await remember({ at: Date.now(), url, title: name || url, ok: false, error: text });
    notify('K Downloader could not take this download', text);
    throw e;
  }
}

/* ---------- capturing Chrome's downloads ---------- */

// Downloads this extension re-issued after a failure must not be captured again.
const passthrough = new Set();

// onDeterminingFilename fires once Chrome knows the file name, still before any byte is saved.
chrome.downloads.onDeterminingFilename.addListener((item) => { capture(item); });

async function capture(item) {
  const { enabled, token, minKB } = await state();
  const url = item.finalUrl || item.url;
  if (!enabled || !token || !/^https?:/i.test(url) || url.startsWith(HELPER)) return;
  if (passthrough.has(url)) { passthrough.delete(url); return; }
  if (item.byExtensionId) return;
  // Account and security pages (backup codes, recovery keys, exported passwords) stay in Chrome: their files are
  // private, tiny, and usually sent by a form that cannot be requested again.
  if (SENSITIVE_SITES.test(url) || SENSITIVE_FILES.test(item.filename || '')) return;
  if (PANEL_SITES.test(url) || PANEL_SITES.test(item.referrer || '')) return;
  if (item.totalBytes > 0 && item.totalBytes < minKB * 1024) return;
  const seen = requestFor(item);
  // A POST (an export form, a "generate and download" button) cannot be requested again: Chrome keeps it.
  if (!seen || (seen.method && seen.method !== 'GET' && seen.method !== 'HEAD')) return;
  // Only downloads worth a download manager, and that a second request can reproduce, leave Chrome: a real file
  // link, or a big file. Small generated files (receipts, reports, exports behind a login) stay where they work.
  const size = item.totalBytes > 0 ? item.totalBytes : (seen.contentLength || 0);
  const fileLink = FILE_EXT.test(url) || FILE_EXT.test(item.filename || '');
  if (/text\/html|application\/xhtml/i.test(seen.contentType || item.mime || '')) return;
  if (size > 0 && size < Math.max(minKB, BIG_FILE_KB) * 1024 && !fileLink) return;
  if (!size && !fileLink) return;
  const name = item.filename ? item.filename.split(/[\\/]/).pop() : '';
  await chrome.downloads.cancel(item.id).catch(() => {});
  await chrome.downloads.erase({ id: item.id }).catch(() => {});
  let job;
  try {
    job = await send(url, name, item.referrer, { contentType: seen.contentType || item.mime || '', disposition: seen.disposition || '' });
    notify('Sent to K Downloader', name || url);
  } catch {
    // The helper refused, so let Chrome save it the normal way.
    passthrough.add(url);
    chrome.downloads.download({ url }).catch(() => {});
    return;
  }
  if (job && job.id) watchJob(job.id, url, name);
}

// A captured download that the helper cannot finish (the link expired, or the site wants more than its cookies)
// goes back to Chrome, so the user never ends up with nothing.
async function watchJob(id, url, name) {
  const until = Date.now() + 10 * 60 * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    let job;
    try { job = await helperGet(`/jobs/${id}`); } catch { return; }
    if (['done', 'cancelled'].includes(job.status)) return;
    if (job.status === 'error') {
      if (job.errorCode === 'method') {
        notify('Download this one again with the switch off', `${name || url} is sent by a form on the page, so only Chrome can save it. Turn the K switch off in the popup and press the download again.`);
        return;
      }
      if (!['unavailable', 'refused', 'login', 'network', 'unknown', 'html-instead-of-file'].includes(job.errorCode)) return;
      passthrough.add(url);
      chrome.downloads.download({ url }).catch(() => {});
      notify('Chrome is saving this one', `K Downloader could not get ${name || url}, so Chrome downloads it the normal way.`);
      return;
    }
  }
}

/* ---------- right-click menu ---------- */

chrome.runtime.onInstalled.addListener(async (details) => {
  // Pairs with the helper on this PC by itself, so installing is the only step.
  if (details.reason === 'install') {
    const { token } = await state();
    if (!token) chrome.tabs.create({ url: `${HELPER}/pair?ext=${chrome.runtime.id}&auto=1` }).catch(() => {});
  }
  chrome.contextMenus.create({ id: 'kd-link', title: 'Download link with K Downloader', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'kd-media', title: 'Download this media with K Downloader', contexts: ['video', 'audio', 'image'] });
  chrome.contextMenus.create({ id: 'kd-page', title: 'Open K Downloader on this page', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'kd-page') {
    if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type: 'menu', name: 'Download from this page' }).catch(() => {});
    return;
  }
  const url = info.menuItemId === 'kd-link' ? info.linkUrl : info.srcUrl;
  if (!url) return;
  send(url, '', info.pageUrl || (tab && tab.url) || '').then(() => notify('Sent to K Downloader', url)).catch(() => {});
});

/* ---------- pairing and popup ---------- */

chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
  if (!sender.url || !sender.url.startsWith(HELPER) || !msg || msg.type !== 'kd-pair' || !/^[a-f0-9]{32}$/.test(msg.token || '')) return reply({ ok: false });
  chrome.storage.local.set({ token: msg.token }).then(() => {
    reply({ ok: true });
    // The tab the extension opened for pairing closes by itself once the code is stored.
    if (msg.auto && sender.tab && sender.tab.id) setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 1500);
  });
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // The page button's calls to the helper, with the pairing code added here.
  if (msg.type === 'api') {
    if (!String(msg.url).startsWith(HELPER + '/')) return reply({ status: 400, text: '{}' });
    state().then(async ({ token }) => {
      try {
        const res = await fetch(msg.url, { method: msg.method, headers: { 'Content-Type': 'application/json', 'X-KD-Token': token }, body: msg.body });
        reply({ status: res.status, text: await res.text() });
      } catch {
        reply({ offline: true });
      }
    });
    return true;
  }
  if (msg.type === 'send') send(msg.url, '', '').then((job) => reply({ ok: true, job })).catch((e) => reply({ ok: false, error: e.message }));
  else if (msg.type === 'ping') {
    state().then(async ({ token }) => {
      if (!token) return reply({ paired: false });
      try {
        const res = await fetch(`${HELPER}/ping`, { headers: { 'X-KD-Token': token } });
        reply({ paired: res.status !== 401, online: res.ok, out: res.ok ? (await res.json()).out : '' });
      } catch {
        reply({ paired: true, online: false });
      }
    });
  } else return false;
  return true;
});
