'use strict';
// Preflight: what every build has to pass before an installer is made. Syntax of every script, the pure search
// modules with fake sites, then a real helper in a throw-away data folder: info, a cut download, image and video
// search through the keyless sources, a channel listing, projects, a social preset and the retry path.
// Run: bin\node.exe tests\preflight.js   (exit code 0 = go)

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const PORT = 17659;
const WORK = path.join(os.tmpdir(), 'kd-preflight');
const DATA = path.join(WORK, 'data');
const OUT = path.join(WORK, 'out');
const PROJECTS = path.join(WORK, 'projects');
const started = Date.now();
let fails = 0;
const ok = (name, pass, detail = '') => { if (!pass) fails += 1; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${String(detail).slice(0, 200)}` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function syntax() {
  const files = ['helper/server.js', 'helper/mcp.js', 'helper/images.js', 'helper/videos.js', 'helper/translate.js', 'helper/make-content.js', 'app/main.js', 'app/browser.js', 'app/scraper.js', 'app/updater.js', 'app/preload.js', 'app/ui/app.js', 'app/latest.js', 'app/extid.js', 'kareem-downloader.user.js', 'extension/background.js', 'extension/popup.js'];
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) { ok(`syntax ${f}`, false, 'missing'); continue; }
    const r = spawnSync(NODE, ['--check', p], { encoding: 'utf8' });
    ok(`syntax ${f}`, r.status === 0, r.stderr.split('\n')[0]);
  }
  try { JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'package.json'), 'utf8')); ok('app/package.json parses', true); } catch (e) { ok('app/package.json parses', false, e.message); }
  try { JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')); ok('extension/manifest.json parses', true); } catch (e) { ok('extension/manifest.json parses', false, e.message); }
}

async function units() {
  const images = require(path.join(ROOT, 'helper', 'images.js'));
  const videos = require(path.join(ROOT, 'helper', 'videos.js'));
  const fake = { pexels: [{ url: 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&w=1600', thumb: 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?w=400', page: 'https://www.pexels.com/photo/x-1/', title: 'Free A girl', tw: 385, th: 578 }] };
  const r = await images.search({ query: 'x', providers: ['pexels'], appOnline: true, scrape: async (p) => ({ items: fake[p] || [] }) });
  ok('images: scraped item maps to sizes', r.items.length === 1 && /w=3840/.test(r.items[0].sizes.large) && r.items[0].orientation === 'portrait', JSON.stringify(r.errors));
  const off = await images.search({ query: 'x', providers: ['pexels'], appOnline: false });
  ok('images: browser source without the app reports it', /app running/.test(off.errors.pexels || ''), JSON.stringify(off.errors));
  const v = await videos.search({ query: 'x', providers: ['pexelsvideo'], appOnline: true, scrape: async () => ({ items: [{ url: 'https://v/a.mp4', page: 'https://www.pexels.com/video/a-1/', title: 'A', duration: 9, w: 3840, h: 2160, files: [{ url: 'https://v/1080.mp4', w: 1920, h: 1080 }, { url: 'https://v/2160.mp4', w: 3840, h: 2160 }] }] }) });
  ok('videos: quality pick 1080 and best', v.items.length === 1 && videos.pickFile(v.items[0], '1080').url.endsWith('1080.mp4') && videos.pickFile(v.items[0], 'best').url.endsWith('2160.mp4'));
  const y = await videos.search({ query: 'x', providers: ['youtube'], ytSearch: async () => ({ entries: [{ id: 'abc', title: 'T', url: 'https://www.youtube.com/watch?v=abc', duration: 5, thumbnails: [] }] }) });
  ok('videos: youtube entries become reference clips', y.items.length === 1 && y.items[0].reference === true && /youtube\.com/.test(y.items[0].pageUrl));
}

/* ---------- a site that behaves like a control panel export ---------- */

// GET /export answers 200 HTML ("Missing parameter"), POST /export answers a real gzip attachment, /fake.gz is
// HTML with a .gz name, /real.gz is a true gzip. 127.0.0.2 because the helper refuses 127.0.0.1 links.
const SITE_PORT = 17658;
const SITE = `http://127.0.0.2:${SITE_PORT}`;
const GZ = Buffer.from('1f8b080000000000000ad3d555f0ad0c0ef4514829cd2de0720e72750c7155087174f271552851d0c84c51f0f40bd1b4e60200063d44eb27000000', 'hex'); // a real gzip of a two-line SQL dump
const HTML = '<!doctype html>\n<html><head><title>phpMyAdmin</title></head><body>Missing parameter: what<br>Missing parameter: export_type</body></html>';
function startSite() {
  return new Promise((resolve) => {
    const server = http.createServer((rq, rs) => {
      const u = new URL(rq.url, SITE);
      if (u.pathname === '/export' && rq.method === 'POST') { rs.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="localhost.sql.gz"' }); return rs.end(GZ); }
      if (u.pathname === '/export') { rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return rs.end(HTML); }
      if (u.pathname === '/fake.gz') { rs.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="backup.sql.gz"' }); return rs.end(HTML); }
      if (u.pathname === '/real.gz') { rs.writeHead(200, { 'Content-Type': 'application/gzip' }); return rs.end(GZ); }
      rs.writeHead(404); rs.end('no');
    });
    server.listen(SITE_PORT, '127.0.0.2', () => resolve(server));
  });
}

/* ---------- the extension's decisions, run in a fake Chrome ---------- */

async function extensionUnits(site) {
  const vm = require('vm');
  const calls = { cancel: [], download: [], sent: [], notify: [] };
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const chrome = {
    storage: { local: { get: async () => ({ token: 'test-token', enabled: true, minKB: 0, recent: [] }), set: async () => {} } },
    downloads: { onDeterminingFilename: on('filename'), cancel: async (id) => { calls.cancel.push(id); }, erase: async () => {}, download: async (o) => { calls.download.push(o.url); } },
    webRequest: { onBeforeRequest: on('before'), onHeadersReceived: on('headers') },
    cookies: { getAll: async () => [{ name: 'sid', value: 'abc' }] },
    notifications: { create: (o) => calls.notify.push(o && o.title) },
    contextMenus: { create: () => {}, onClicked: on('menu') },
    runtime: { id: 'ext', onInstalled: on('installed'), onMessage: on('message'), onMessageExternal: on('external') },
    tabs: { create: async () => {}, remove: async () => {}, sendMessage: async () => {} },
  };
  const fetchStub = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:17653')) { calls.sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'job1', label: 'File', status: 'queued' }) }; }
    throw new Error('unexpected fetch ' + url);
  };
  const ctx = vm.createContext({ chrome, fetch: fetchStub, URL, setTimeout, clearTimeout, console, Date, Map, Set, JSON, Promise });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'extension', 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  const item = (id, url, filename, referrer = `${SITE}/db.php`) => ({ id, url, finalUrl: url, filename, referrer, totalBytes: -1, mime: 'application/gzip' });

  // (a) the export form: Chrome's request was a POST, so the download must stay in Chrome, untouched.
  listeners.before({ url: `${SITE}/export`, method: 'POST', tabId: 1 });
  listeners.headers({ url: `${SITE}/export`, statusCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/gzip' }, { name: 'Content-Disposition', value: 'attachment; filename="localhost.sql.gz"' }] });
  await listeners.filename(item(1, `${SITE}/export`, 'localhost.sql.gz'));
  await wait(50);
  ok('extension: a POST export is left to Chrome (not cancelled, not sent)', calls.cancel.length === 0 && calls.sent.length === 0, `cancel=${calls.cancel.length} sent=${calls.sent.length}`);
  // ...and what Chrome would save from that POST is a real gzip.
  const posted = await new Promise((resolve, reject) => { const r = http.request(`${SITE}/export`, { method: 'POST' }, (rs) => { const b = []; rs.on('data', (d) => b.push(d)); rs.on('end', () => resolve(Buffer.concat(b))); }); r.on('error', reject); r.end('what=sql&export_type=server'); });
  ok('extension: the form answer Chrome keeps is intact gzip', posted.length === GZ.length && posted.toString('hex', 0, 2) === '1f8b', posted.toString('hex', 0, 4));

  // (b) a GET link: captured, and Chrome's Content-Type and Content-Disposition travel with it.
  listeners.before({ url: `${SITE}/fake.gz`, method: 'GET', tabId: 1 });
  listeners.headers({ url: `${SITE}/fake.gz`, statusCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/gzip' }, { name: 'Content-Disposition', value: 'attachment; filename="backup.sql.gz"' }] });
  await listeners.filename(item(2, `${SITE}/fake.gz`, 'backup.sql.gz'));
  await wait(50);
  const sent = calls.sent[0];
  ok('extension: a GET download is captured with the headers Chrome saw', calls.cancel.length === 1 && sent && sent.option.kind === 'file' && sent.option.expect && /gzip/.test(sent.option.expect.contentType) && /attachment/.test(sent.option.expect.disposition) && sent.option.cookie === 'sid=abc', JSON.stringify(sent && sent.option).slice(0, 160));

  // (c) a download Chrome never requested (no record at all) stays in Chrome too; cPanel ports and phpMyAdmin paths always do.
  await listeners.filename(item(3, `${SITE}/unknown.zip`, 'unknown.zip'));
  await listeners.filename(item(4, `https://host.example.com:2083/cpsess123/download?x=1`, 'backup.tar.gz'));
  listeners.before({ url: `https://host.example.com/phpMyAdmin/export.php`, method: 'GET', tabId: 1 });
  await listeners.filename(item(5, `https://host.example.com/phpMyAdmin/export.php`, 'db.sql'));
  await wait(50);
  ok('extension: unseen requests, cPanel ports and phpMyAdmin stay in Chrome', calls.cancel.length === 1, `cancel=${calls.cancel.length}`);
}

function req(method, route, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: route, method, timeout: 120000, headers: { 'Content-Type': 'application/json', 'X-KD-Paths': '1', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => { let j = {}; try { j = JSON.parse(s); } catch { /* */ } resolve({ status: res.statusCode, data: j }); });
    });
    r.on('error', reject); r.on('timeout', () => r.destroy(new Error('timeout')));
    if (data) r.write(data);
    r.end();
  });
}

async function live() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PROJECTS, { recursive: true });
  const env = { ...process.env, KD_PORT: String(PORT), KD_DATA: DATA, KD_OUT: OUT, KD_PROJECTS: PROJECTS };
  let helper = spawn(NODE, [path.join(ROOT, 'helper', 'server.js')], { env, stdio: 'ignore', windowsHide: true });
  let health = null;
  for (let i = 0; i < 40 && !health; i++) { await wait(500); health = await req('GET', '/health').then((r) => r.data).catch(() => null); }
  ok('helper starts', Boolean(health && health.ok), JSON.stringify(health));
  if (!health) return;
  const token = fs.readFileSync(path.join(DATA, 'pairing-code.txt'), 'utf8').trim();
  const auth = { 'X-KD-Token': token };
  const api = (m, r, b) => req(m, r, b, auth);
  const jobsDone = async (ids, seconds) => {
    const until = Date.now() + seconds * 1000;
    let jobs;
    for (;;) { jobs = (await api('GET', '/jobs')).data.jobs.filter((j) => ids.includes(j.id)); if (jobs.every((j) => !['queued', 'running'].includes(j.status)) || Date.now() > until) return jobs; await wait(1000); }
  };

  const unauth = await req('GET', '/jobs');
  ok('requests without the pairing code are refused', unauth.status === 401, unauth.status);

  const info = await api('POST', '/info', { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' });
  ok('video info (YouTube)', info.status === 200 && info.data.title === 'Me at the zoo', info.data.title || info.data.error);

  const cut = await api('POST', '/download', { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'zoo', option: { kind: 'audio', format: 'mp3-192', range: { start: 2, end: 6 } }, videoId: 'jNQXAC9IVRw', key: 'pf-audio' });
  const [cutJob] = await jobsDone([cut.data.id], 120);
  ok('audio cut downloads', cutJob && cutJob.status === 'done' && fs.existsSync(cutJob.file) && fs.statSync(cutJob.file).size > 20000, cutJob && (cutJob.error || cutJob.file));

  const square = await api('POST', '/download', { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'zoo sq', option: { kind: 'video', height: 360, preset: 'square', range: { start: 0, end: 3 } }, videoId: 'jNQXAC9IVRw', key: 'pf-square' });
  const [sqJob] = await jobsDone([square.data.id], 180);
  let dims = '';
  if (sqJob && sqJob.file) { const p = spawnSync(path.join(ROOT, 'bin', 'ffprobe.exe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', sqJob.file], { encoding: 'utf8' }); dims = p.stdout.trim(); }
  ok('square preset gives 1080x1080', sqJob && sqJob.status === 'done' && /^1080,1080/.test(dims), sqJob && (sqJob.error || dims));

  const img = await api('POST', '/images/search', { query: 'coffee cup', providers: ['openverse', 'wikimedia'], perPage: 5 });
  ok('image search (Openverse + Wikimedia)', img.status === 200 && img.data.items.length >= 5, `${img.data.items && img.data.items.length} items ${JSON.stringify(img.data.errors)}`);

  const vid = await api('POST', '/videos/search', { query: 'coffee', providers: ['youtube', 'dailymotion'], perPage: 4 });
  ok('video search (YouTube + Dailymotion)', vid.status === 200 && vid.data.items.length >= 4, `${vid.data.items && vid.data.items.length} items ${JSON.stringify(vid.data.errors)}`);

  const pl = await api('POST', '/playlist', { url: 'https://www.youtube.com/@jawed/videos', limit: 2 });
  ok('channel listing with limit', pl.status === 200 && pl.data.entries.length > 0 && pl.data.entries.length <= 2, pl.data.error || pl.data.entries.length);

  const use = await api('POST', '/projects/use', { name: 'Preflight Film' });
  ok('project created with buckets', use.status === 200 && fs.existsSync(path.join(PROJECTS, 'Preflight Film', '04 Photos')), JSON.stringify(use.data).slice(0, 120));
  const pick = img.data.items.find((i) => i.provider === 'wikimedia') || img.data.items[0];
  const dl = await api('POST', '/images/download', { items: [pick], size: 'small', query: 'coffee cup' });
  const [imgJob] = await jobsDone(dl.data.jobs.map((j) => j.id), 120);
  ok('image lands in the project photos bucket', imgJob && imgJob.status === 'done' && imgJob.file.includes(path.join('Preflight Film', '04 Photos')) && fs.existsSync(path.join(path.dirname(imgJob.file), 'manifest.csv')), imgJob && (imgJob.error || imgJob.file));
  await api('POST', '/projects/use', { name: '' });

  // A name that cannot resolve fails fast, so the retry path shows within seconds.
  const deadUrl = 'https://nowhere.kdownloader.invalid/none.bin';
  const bad = await api('POST', '/download', { url: deadUrl, title: 'unreachable', option: { kind: 'file' } });
  let retrying = null;
  for (let i = 0; i < 60 && !retrying; i++) { await wait(1000); const j = (await api('GET', '/jobs')).data.jobs.find((x) => x.id === bad.data.id); if (j && j.stage === 'retry') retrying = j; }
  ok('a dead host is retried, not failed at once', Boolean(retrying), retrying ? retrying.extra : 'no retry stage seen');
  // The queue file holds the retrying job; a fresh helper takes it back.
  await wait(500);
  const queued = JSON.parse(fs.readFileSync(path.join(DATA, 'queue.json'), 'utf8'));
  ok('unfinished job is saved to queue.json', queued.some((q) => q.url === deadUrl), `${queued.length} saved`);
  helper.kill();
  await wait(1500);
  helper = spawn(NODE, [path.join(ROOT, 'helper', 'server.js')], { env, stdio: 'ignore', windowsHide: true });
  health = null;
  for (let i = 0; i < 40 && !health; i++) { await wait(500); health = await req('GET', '/health').then((r) => r.data).catch(() => null); }
  const after = (await api('GET', '/jobs')).data.jobs;
  ok('restarted helper resumes the saved job', after.some((j) => j.title === 'unreachable' && ['queued', 'running'].includes(j.status)), after.map((j) => `${j.title}:${j.status}`).join(','));
  for (const j of after) await api('POST', `/jobs/${j.id}/cancel`);

  const sh = await api('GET', '/sources/health');
  ok('source health endpoint answers', sh.status === 200 && typeof sh.data.sources === 'object');

  // A page saved under a file's name is never a success: the bytes are checked and the job fails with no file left.
  const before = fs.readdirSync(OUT, { recursive: true }).length;
  const fake = await api('POST', '/download', { url: `${SITE}/fake.gz`, title: 'backup.sql.gz', option: { kind: 'file', name: 'backup.sql.gz' } });
  const [fakeJob] = await jobsDone([fake.data.id], 30);
  const leftover = fs.readdirSync(OUT, { recursive: true }).filter((n) => /backup\.sql\.gz$/i.test(String(n)));
  ok('a .gz that is really HTML fails with html-instead-of-file', fakeJob && fakeJob.status === 'error' && fakeJob.errorCode === 'html-instead-of-file', fakeJob && `${fakeJob.status} ${fakeJob.errorCode} ${fakeJob.error}`);
  ok('...and no file is left behind', leftover.length === 0 && fs.readdirSync(OUT, { recursive: true }).length === before, leftover.join(','));
  // The export URL the browser got from a POST: the helper's GET gets a page where Chrome got a gzip, caught before saving.
  const exp = await api('POST', '/download', { url: `${SITE}/export`, title: 'localhost.sql.gz', option: { kind: 'file', name: 'localhost.sql.gz', expect: { contentType: 'application/gzip', disposition: 'attachment; filename="localhost.sql.gz"' } } });
  const [expJob] = await jobsDone([exp.data.id], 30);
  ok('a page where Chrome got a file is refused before download', expJob && expJob.status === 'error' && expJob.errorCode === 'html-instead-of-file', expJob && `${expJob.status} ${expJob.errorCode} ${expJob.error}`);
  const real = await api('POST', '/download', { url: `${SITE}/real.gz`, title: 'real.gz', option: { kind: 'file', name: 'real.gz' } });
  const [realJob] = await jobsDone([real.data.id], 30);
  ok('a true gzip downloads and keeps its name', realJob && realJob.status === 'done' && /real\.gz$/.test(realJob.file) && fs.readFileSync(realJob.file).toString('hex', 0, 2) === '1f8b', realJob && (realJob.error || realJob.file));

  helper.kill();
}

(async () => {
  console.log('K Downloader preflight');
  syntax();
  await units();
  const site = await startSite();
  await extensionUnits(site).catch((e) => ok('extension units', false, e.stack));
  // --quick (CI): everything that needs no network and no real sites.
  if (!process.argv.includes('--quick')) await live().catch((e) => ok('live helper run', false, e.message));
  site.close();
  console.log(`${fails ? `${fails} FAILED` : 'ALL PASSED'} in ${Math.round((Date.now() - started) / 1000)} s`);
  process.exit(fails ? 1 : 0);
})();
