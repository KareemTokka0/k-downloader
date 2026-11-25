'use strict';
// K Downloader (Kareem Downloader Tool) local helper. Listens on 127.0.0.1 only and drives yt-dlp + ffmpeg
// for the userscript. No dependencies, no telemetry, no remote config.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const images = require('./images.js');
const videos = require('./videos.js');
const translate = require('./translate.js');

const VERSION = '3.6.1';
const HOST = '127.0.0.1';
const PORT = Number(process.env.KD_PORT) || 17653;
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin');
// Outside the program folder, so cookies and the pairing code never travel with a shared or cloud-synced copy.
const LEGACY_DATA = path.join(ROOT, 'data');
const DATA = process.env.KD_DATA || path.join(process.env.LOCALAPPDATA || os.homedir(), 'K Downloader');
// Big, replaceable things (partial downloads, speech models, the GPU engine) can live on another drive.
const CACHE = process.env.KD_CACHE || DATA;
const TMP = path.join(CACHE, 'tmp');
const OUT = process.env.KD_OUT || path.join(os.homedir(), 'Downloads', 'K Downloader');
// Optional root of project folders. While a project is active, downloads land inside it instead of OUT.
const PROJECTS = process.env.KD_PROJECTS || '';
const PROJECT_FILE = path.join(DATA, 'project.json');
const BUCKETS = { brief: '01 Brief', references: '02 References', footage: '03 Footage', photos: '04 Photos', exports: '05 Exports' };
const QUEUE_FILE = path.join(DATA, 'queue.json');
const SOURCES_FILE = path.join(DATA, 'sources.json');
// Social-format presets: the picture is scaled to cover the frame and centre-cropped, as H.264 for upload.
const PRESETS = {
  reel: { w: 1080, h: 1920, label: 'Reel 9:16' },
  story: { w: 1080, h: 1920, label: 'Story 9:16' },
  square: { w: 1080, h: 1080, label: 'Square 1:1' },
  portrait: { w: 1080, h: 1350, label: 'Portrait 4:5' },
  landscape: { w: 1920, h: 1080, label: 'Landscape 16:9' },
};
const YTDLP = path.join(BIN, 'yt-dlp.exe');
const FFMPEG = path.join(BIN, 'ffmpeg.exe');
const FFPROBE = path.join(BIN, 'ffprobe.exe');
const ARIA2 = path.join(BIN, 'aria2c.exe');
const WHISPER = path.join(BIN, 'whisper', 'whisper-cli.exe');
// The CUDA build of whisper.cpp is an optional 650 MB download; it runs several times faster on an NVIDIA card.
const WHISPER_CUDA_DIR = path.join(CACHE, 'whisper-cuda');
const WHISPER_CUDA = path.join(WHISPER_CUDA_DIR, 'whisper-cli.exe');
const WHISPER_CUDA_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip';
const TRANSLATE_LANGS = Object.keys(translate.LANGS);
const MODELS = path.join(CACHE, 'models');
// Speech-to-text models, fetched on first use. Turbo understands Arabic far better; small is for quick drafts.
const WHISPER_MODELS = {
  turbo: { file: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195, name: 'Large v3 turbo' },
  small: { file: 'ggml-small.bin', size: 487601967, name: 'Small' },
};
const WHISPER_LANGS = ['auto', 'ar', 'en', 'fr', 'de', 'es', 'it', 'tr', 'ru', 'hi', 'ur', 'fa', 'id', 'pt', 'zh', 'ja', 'ko'];
// Partial plain-file downloads live here between runs, so a cancelled or interrupted one resumes.
const FILES = path.join(CACHE, 'files');
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const HISTORY_FILE = path.join(DATA, 'history.json');
const ENGINE_FILE = path.join(DATA, 'engine.json');
const KEYS_FILE = path.join(DATA, 'keys.json');
const NODE_RUNTIME = fs.existsSync(path.join(BIN, 'node.exe')) ? path.join(BIN, 'node.exe') : process.execPath;
const COOKIES = path.join(DATA, 'cookies.txt');
// Cookies from the app's built-in browser, kept only while the helper runs.
const BROWSER_COOKIES = path.join(TMP, 'browser-cookies.txt');
const cookieState = { count: 0, hosts: [], at: 0 };
const TOKEN_FILE = path.join(DATA, 'pairing-code.txt');
const USERSCRIPT = path.join(ROOT, 'kareem-downloader.user.js');
const USERSCRIPT_PATH = '/kareem-downloader.user.js';

const MAX_CONCURRENT = 2;
const MAX_KEPT_JOBS = 50;
const MAX_HISTORY = 1000;
const MAX_PLAYLIST = 300;
const MAX_BODY = 64 * 1024;
const MAX_HEIGHT = 2160;
const INFO_TTL = 5 * 60 * 1000;
// Sites change often enough that a day-old engine can already be broken.
const ENGINE_CHECK_EVERY = 24 * 60 * 60 * 1000;
// OrangeMonkey aborts any request after 60s, so the helper has to answer before that.
const INFO_TIMEOUT = 55 * 1000;

const AUDIO = {
  'mp3-320': { tag: ' 320k', args: ['-x', '--audio-format', 'mp3', '--audio-quality', '320K', '--embed-thumbnail', '--convert-thumbnails', 'jpg'] },
  'mp3-192': { tag: ' 192k', args: ['-x', '--audio-format', 'mp3', '--audio-quality', '192K', '--embed-thumbnail', '--convert-thumbnails', 'jpg'] },
  'm4a': { args: ['-x', '--audio-format', 'm4a', '--embed-thumbnail', '--convert-thumbnails', 'jpg'], format: 'ba[ext=m4a]/ba/b' },
  'wav': { args: ['-x', '--audio-format', 'wav'] },
};

// Moves data left in the program folder by older versions. The originals go, so they stop syncing.
function migrateLegacyData() {
  if (process.env.KD_DATA || !fs.existsSync(LEGACY_DATA)) return;
  for (const name of ['pairing-code.txt', 'history.json', 'cookies.txt']) {
    const from = path.join(LEGACY_DATA, name);
    if (!fs.existsSync(from)) continue;
    const to = path.join(DATA, name);
    if (!fs.existsSync(to)) fs.copyFileSync(from, to);
    fs.rmSync(from);
  }
  fs.rmSync(LEGACY_DATA, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
}

// Editing formats beyond H.264: intra-frame codecs that scrub smoothly on a timeline, at the cost of size.
const PRO_FORMATS = {
  prores: { suffix: 'ProRes', pixels: 'yuv422p10le', args: ['-c:v', 'prores_ks', '-profile:v', '2', '-vendor', 'apl0'] },
  dnxhr: { suffix: 'DNxHR', pixels: 'yuv422p', args: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq'] },
};
const EDIT_FORMATS = ['h264', ...Object.keys(PRO_FORMATS)];

fs.mkdirSync(DATA, { recursive: true });
migrateLegacyData();
// Jobs don't survive a restart, so anything here is left over from a crash or a power cut.
fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
fs.mkdirSync(TMP, { recursive: true });

function loadToken() {
  try {
    const saved = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(saved)) return { token: saved, created: false };
  } catch { /* first run */ }
  const token = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token + os.EOL);
  return { token, created: true };
}
const { token: TOKEN } = loadToken();

function baseArgs() {
  const args = [
    '--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-warnings', '--no-colors',
    '--encoding', 'utf-8',
    // Trust the Windows certificate store, not only the bundled list: antivirus HTTPS scanning (Avast, Kaspersky,
    // ESET) signs every site with its own root, which lives in the store and nowhere else.
    '--compat-options', 'no-certifi',
    '--ffmpeg-location', BIN,
    '--js-runtimes', `node:${NODE_RUNTIME}`,
  ];
  // The browser's logins win over a hand-made cookies.txt.
  if (cookieState.count && fs.existsSync(BROWSER_COOKIES)) args.push('--cookies', BROWSER_COOKIES);
  else if (fs.existsSync(COOKIES)) args.push('--cookies', COOKIES);
  return args;
}

// Started by the sign-in task, the process can arrive without a usable TEMP and with System32 as its folder;
// yt-dlp then tries to write its temp files there and fails with "Permission denied". Every tool gets our own
// temp folder and starts inside it.
function childEnv() {
  fs.mkdirSync(TMP, { recursive: true });
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', TEMP: TMP, TMP, TMPDIR: TMP };
}

// Maps raw yt-dlp errors to a stable code the script can show in plain words.
// The order matters: "Requested format is not available" is an engine problem, not a missing video.
function classifyError(text) {
  const t = String(text || '');
  if (/Unsupported URL/i.test(t)) return 'unsupported';
  if (/\bDRM\b/i.test(t)) return 'drm';
  if (/HTTP Error 429|Too Many Requests|rate.?limit/i.test(t)) return 'ratelimit';
  if (/No space left|ENOSPC|not enough space/i.test(t)) return 'disk';
  if (/not a bot|Sign in to confirm|login required|\blog ?in\b|--cookies|\bprivate\b|members-only|age-restricted|confirm your age/i.test(t)) return 'login';
  if (/Requested format is not available|Signature|nsig|player response|Unable to extract/i.test(t)) return 'engine';
  if (/Video unavailable|has been removed|not available|does not exist|HTTP Error 404/i.test(t)) return 'unavailable';
  if (/HTTP Error 405|405 Method Not Allowed/i.test(t)) return 'method';
  if (/Unable to (download|connect)|timed out|getaddrinfo|Connection|HTTP Error 5/i.test(t)) return 'network';
  return 'unknown';
}

function lastErrorLine(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  const err = lines.reverse().find((l) => l.startsWith('ERROR')) || lines[0] || '';
  return err.replace(/^ERROR:\s*/, '').slice(0, 300);
}

/* ---------- video info ---------- */

const infoCache = new Map();

function runInfo(url, extra = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [...baseArgs(), ...extra, '-J', '--', url], { windowsHide: true, env: childEnv(), cwd: TMP });
    const out = [];
    let err = '';
    const timer = setTimeout(() => {
      killTree(proc);
      reject(Object.assign(new Error('timed out'), { code: 'network' }));
    }, INFO_TIMEOUT);
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(Object.assign(e, { code: 'engine' }));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(Object.assign(new Error(lastErrorLine(err) || 'yt-dlp failed'), { code: classifyError(err) }));
      }
      try {
        resolve(JSON.parse(Buffer.concat(out).toString('utf8')));
      } catch (e) {
        reject(Object.assign(e, { code: 'engine' }));
      }
    });
  });
}

const formatSize = (f, duration) =>
  f.filesize || f.filesize_approx || (f.tbr && duration ? Math.round((f.tbr * 1000 / 8) * duration) : 0);

// YouTube offers auto-translated captions in over 100 languages, so only the original track plus Arabic and English are listed.
function listSubtitles(raw) {
  const subs = [];
  const seen = new Set();
  for (const [lang, tracks] of Object.entries(raw.subtitles || {})) {
    if (lang === 'live_chat' || !tracks.length) continue;
    subs.push({ lang, name: tracks[0].name || lang, auto: false });
    seen.add(lang);
  }
  for (const [lang, tracks] of Object.entries(raw.automatic_captions || {})) {
    if (seen.has(lang) || !tracks.length) continue;
    if (!/[?&]tlang=/.test(tracks[0].url || '') || lang === 'ar' || lang === 'en') {
      subs.push({ lang, name: tracks[0].name || lang, auto: true });
    }
  }
  return subs;
}

function summarize(raw) {
  const formats = raw.formats || [];
  const duration = raw.duration || 0;
  const isVideo = (f) => f.vcodec && f.vcodec !== 'none' && (f.height || f.width);
  const isAudioOnly = (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none');

  const audioOnly = formats.filter(isAudioOnly);
  const bestAudio = audioOnly.reduce((a, b) => ((b.abr || b.tbr || 0) > (a?.abr || a?.tbr || 0) ? b : a), null);
  const audioSize = bestAudio ? formatSize(bestAudio, duration) : 0;

  // Quality is the shorter side, so a vertical 1080x1920 Short counts as 1080p.
  // The score mirrors the -S order in buildArgs, so the size shown matches the file that gets downloaded.
  const score = (f, q) => [
    f.fps || 0,
    String(f.vcodec).startsWith(q > 1080 ? 'vp' : 'avc') ? 1 : 0,
    /^https?$/.test(f.protocol || '') ? 1 : 0,
    formatSize(f, duration),
  ];
  const beats = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  const byQuality = new Map();
  for (const f of formats.filter(isVideo)) {
    const q = Math.min(f.width || f.height, f.height || f.width);
    if (!q || q > MAX_HEIGHT) continue;
    const s = score(f, q);
    const cur = byQuality.get(q);
    if (!cur || beats(s, cur.score)) {
      const hasAudio = f.acodec && f.acodec !== 'none';
      const long = Math.max(f.width || 0, f.height || 0);
      byQuality.set(q, { height: q, long, fps: f.fps || 0, size: formatSize(f, duration), hasAudio, score: s });
    }
  }
  const video = [...byQuality.values()]
    .sort((a, b) => b.height - a.height)
    .map((v) => ({
      height: v.height,
      long: v.long,
      fps: v.fps ? Math.round(v.fps) : 0,
      size: v.size ? v.size + (v.hasAudio ? 0 : audioSize) : 0,
    }));

  const hasAudio = audioOnly.length > 0 || formats.some((f) => f.acodec && f.acodec !== 'none');
  return {
    id: raw.id,
    title: raw.title || raw.id || '',
    uploader: raw.uploader || raw.channel || '',
    duration,
    thumbnail: raw.thumbnail || '',
    site: raw.extractor_key || raw.extractor || '',
    url: raw.webpage_url || '',
    isLive: raw.is_live === true,
    video,
    audio: hasAudio ? { bitrate: bestAudio ? Math.round(bestAudio.abr || bestAudio.tbr || 0) : 0, size: audioSize } : null,
    subtitles: listSubtitles(raw),
    hasThumbnail: Boolean(raw.thumbnail || (raw.thumbnails || []).length),
  };
}

async function getInfo(url) {
  const hit = infoCache.get(url);
  if (hit && Date.now() - hit.at < INFO_TTL) return hit.info;
  const info = summarize(await runInfo(url));
  infoCache.set(url, { at: Date.now(), info });
  if (infoCache.size > 100) infoCache.delete(infoCache.keys().next().value);
  return info;
}

// A playlist, or a channel's videos tab (newest first). "after" (YYYYMMDD) needs each video's date, so that mode
// reads the entries fully and stops at the first one that is too old.
async function getPlaylist(url, { limit = MAX_PLAYLIST, after = '' } = {}) {
  const end = Math.min(Math.max(Number(limit) || MAX_PLAYLIST, 1), MAX_PLAYLIST);
  const args = ['--yes-playlist', '--playlist-end', String(end)];
  if (/^\d{8}$/.test(after)) args.push('--dateafter', after, '--break-on-reject', '--ignore-no-formats-error');
  else args.push('--flat-playlist');
  const raw = await runInfo(url, args);
  const entries = (raw.entries || [])
    .filter((e) => e && e.id && (e.url || e.webpage_url) && !/^\[(private|deleted)/i.test(e.title || ''))
    .map((e) => ({ id: e.id, title: e.title || e.id, url: e.webpage_url || e.url, duration: e.duration || 0, date: e.upload_date || '' }));
  return { id: raw.id, title: raw.title || raw.id || '', uploader: raw.uploader || raw.channel || '', entries, limit: end };
}

/* ---------- history ---------- */

function loadHistory() {
  try {
    const list = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
const history = loadHistory();

function saveHistory() {
  const next = `${HISTORY_FILE}.tmp`;
  fs.writeFileSync(next, JSON.stringify(history));
  fs.renameSync(next, HISTORY_FILE);
}

function addHistory(job) {
  if (!job.file || !fs.existsSync(job.file)) return;
  const old = history.findIndex((h) => h.file === job.file);
  if (old >= 0) history.splice(old, 1);
  history.unshift({
    id: crypto.randomBytes(6).toString('hex'),
    videoId: job.videoId, key: job.key, url: job.url, title: job.title, label: job.label,
    file: job.file, size: fs.statSync(job.file).size, at: Date.now(),
  });
  history.length = Math.min(history.length, MAX_HISTORY);
  saveHistory();
}

function findDownloaded(videoId, key) {
  if (!videoId || !key) return null;
  return history.find((h) => h.videoId === videoId && h.key === key && fs.existsSync(h.file)) || null;
}

const doneKeys = (videoId) =>
  history.filter((h) => h.videoId === videoId && fs.existsSync(h.file)).map((h) => h.key);

/* ---------- download jobs ---------- */

const jobs = new Map();

/* ---------- projects: where downloads land ---------- */

function listProjects() {
  if (!PROJECTS || !fs.existsSync(PROJECTS)) return [];
  return fs.readdirSync(PROJECTS, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
}
function currentProject() {
  try {
    const p = JSON.parse(fs.readFileSync(PROJECT_FILE, 'utf8'));
    if (p && p.name && PROJECTS && fs.existsSync(path.join(PROJECTS, p.name))) return { name: p.name, path: path.join(PROJECTS, p.name) };
  } catch { /* none */ }
  return null;
}
// Picks (or creates) a project; an empty name goes back to the Downloads folder.
function useProject(name) {
  const clean = safeFolder1(name);
  if (!clean) { fs.rmSync(PROJECT_FILE, { force: true }); return null; }
  if (!PROJECTS) throw Object.assign(new Error('No projects folder is set. Choose one in Settings first.'), { http: 400 });
  const dir = path.join(PROJECTS, clean);
  for (const b of Object.values(BUCKETS)) fs.mkdirSync(path.join(dir, b), { recursive: true });
  fs.writeFileSync(PROJECT_FILE, JSON.stringify({ name: clean, at: Date.now() }));
  return { name: clean, path: dir };
}
// The folder new downloads are relative to: the active project, otherwise OUT.
const baseDir = () => { const p = currentProject(); return p ? p.path : OUT; };
// Default subfolder for a kind of download: inside a project it is the bucket; otherwise the old flat layout.
function defaultFolder(bucket, sub) {
  const project = currentProject();
  if (project) return path.join(BUCKETS[bucket] || '', safeFolder1(sub) || '');
  const flat = { photos: 'Images', footage: 'Footage', references: 'Footage' }[bucket];
  return flat ? path.join(flat, safeFolder1(sub) || 'search') : (safeFolder1(sub) || '');
}

/* ---------- queue on disk: unfinished jobs come back after a restart ---------- */

let queueTimer = 0;
function saveQueue() {
  clearTimeout(queueTimer);
  queueTimer = setTimeout(() => {
    const pending = [...jobs.values()].filter((j) => ['queued', 'running'].includes(j.status)).map((j) => ({
      url: j.url, title: j.title, option: { ...j.option, cookie: undefined }, folder: j.folder, base: j.base, videoId: j.videoId, key: j.key, force: j.force, fallbackToFile: j.fallbackToFile, attempts: j.attempts || 0,
    }));
    try { fs.writeFileSync(QUEUE_FILE, JSON.stringify(pending)); } catch { /* disk */ }
  }, 300);
}
function restoreQueue() {
  let saved = [];
  try { saved = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch { return 0; }
  if (!Array.isArray(saved)) return 0;
  for (const s of saved) {
    if (!s || !validUrl(s.url) || !s.option || typeof s.option !== 'object') continue;
    const job = createJob(s.url, s.title, s.option, { folder: s.folder, base: s.base, videoId: s.videoId, key: s.key, force: s.force, fallbackToFile: s.fallbackToFile });
    job.attempts = Number(s.attempts) || 0;
    job.extra = 'resumed after restart';
  }
  return saved.length;
}

/* ---------- manifest: one sheet per folder for the editor ---------- */

function appendManifest(dir, rows) {
  if (!rows.length) return;
  const file = path.join(dir, 'manifest.csv');
  const cell = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
  const header = 'file,title,author,license,source,seconds,width,height,kind\r\n';
  fs.mkdirSync(dir, { recursive: true });
  const exists = fs.existsSync(file);
  fs.appendFileSync(file, `${exists ? '' : '﻿' + header}${rows.map((r) => [r.file, r.title, r.author, r.license, r.source, r.seconds, r.width, r.height, r.kind].map(cell).join(',')).join('\r\n')}\r\n`);
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  // A plain fetch has no process tree; it only knows how to abort itself.
  if (!proc.pid) return proc.kill();
  spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
}

const needsFinishing = (option) => option.kind === 'video' && Boolean(option.edit || option.subs || option.preset);

function rangeTag(range) {
  if (!range) return '';
  const part = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h ? `${h}h` : ''}${m}m${Math.floor(s % 60)}s`;
  };
  return ` ${part(range.start)}-${part(range.end)}`;
}

function commonArgs(job) {
  const args = [...baseArgs(), '--windows-filenames'];
  if (job.force) args.push('--force-overwrites');
  return args;
}

function buildArgs(job) {
  const { option, url, tmp } = job;
  const home = needsFinishing(option) ? tmp : job.out;
  const args = [
    ...commonArgs(job),
    '--no-quiet', '--progress', '--newline',
    '--embed-metadata', '--concurrent-fragments', '4',
    '--progress-template', 'download:OXP|%(progress.status)s|%(progress._percent_str)s|%(progress.speed)s|%(progress.eta)s',
    '--print', 'after_move:OXDONE|%(filepath)s',
    // Gives jobs started from a bare link their real title and id.
    '--print', 'video:OXTITLE|%(id)s|%(title)s', '--no-simulate',
    '-P', home, '-P', `temp:${path.join(tmp, 'parts')}`,
  ];
  if (option.range) {
    // Without forced keyframes the cut would snap to the nearest keyframe, seconds away from what was asked.
    args.push('--download-sections', `*${option.range.start}-${option.range.end}`, '--force-keyframes-at-cuts');
  }
  const tag = rangeTag(option.range);
  if (option.kind === 'audio') {
    const preset = AUDIO[option.format];
    args.push('-f', preset.format || 'ba/b', ...preset.args, '-o', `%(title).150B [%(id)s]${preset.tag || ''}${tag}.%(ext)s`);
  } else {
    // H.264 opens everywhere but stops at 1080p on most sites; above that VP9 beats AV1 on device support.
    const codec = option.height > 1080 ? 'vp9' : 'h264';
    const editTag = option.edit ? ` ${PRO_FORMATS[option.edit] ? PRO_FORMATS[option.edit].suffix : 'H264'}` : '';
    const suffix = `${tag}${editTag}${option.subs ? ` ${option.subs.mode}-${option.subs.source === 'whisper' ? 'ai-' : ''}${option.subs.translateTo || option.subs.lang}` : ''}`;
    args.push(
      '-f', 'bv*+ba/b',
      // HDR looks washed out once it reaches an SDR timeline, so plain SDR comes first when both exist.
      '-S', `res:${option.height},fps,hdr:sdr,vcodec:${codec},acodec:m4a`,
      // yt-dlp would pick MKV for VP9, but VP9 in MP4 is valid and opens in more players.
      '--merge-output-format', option.height > 1080 ? 'mp4' : 'mp4/mkv',
      '-o', `%(title).130B [%(id)s] %(height)sp${suffix}.%(ext)s`,
    );
  }
  args.push('--', url);
  return args;
}

// Web pages never see file paths; a local tool with the token may ask for them.
const wantsPaths = (req) => req.headers['x-kd-paths'] === '1';

function publicJob(j, withPath) {
  return {
    ...(withPath ? { file: j.file || '' } : {}),
    id: j.id, title: j.title, label: j.label, status: j.status, stage: j.stage,
    percent: j.percent, speed: j.speed, eta: j.eta, pass: j.pass, total: j.total || 0, kind: j.option.kind, extra: j.extra || '',
    error: j.error, errorCode: j.errorCode, hasFile: Boolean(j.file),
    videoId: j.videoId, key: j.key,
  };
}

function handleLine(job, line) {
  if (line.startsWith('OXP|')) {
    const [, status, percent, speed, eta] = line.split('|');
    if (status === 'downloading' || status === 'finished') {
      job.stage = 'download';
      const p = parseFloat(percent);
      if (Number.isFinite(p)) job.percent = p;
      job.speed = Number(speed) || 0;
      job.eta = Number(eta) || 0;
    }
  } else if (line.startsWith('OXTITLE|')) {
    const [, id, ...title] = line.split('|');
    if (job.title === job.url) job.title = title.join('|').slice(0, 200);
    if (!job.videoId) job.videoId = id.slice(0, 100);
  } else if (line.startsWith('OXDONE|')) {
    job.file = line.slice('OXDONE|'.length).trim();
  } else if (line.startsWith('[download] Destination:')) {
    job.pass += 1;
    job.stage = 'download';
    job.percent = 0;
  } else if (/^\[(Merger|ExtractAudio|VideoRemuxer|VideoConvertor|EmbedThumbnail|Metadata|FixupM3u8|FixupM4a)\]/.test(line)) {
    job.stage = 'process';
    job.percent = 100;
    job.speed = 0;
    job.eta = 0;
  }
}

function cleanupTmp(job) {
  fs.rm(job.tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }, () => {});
}

// Runs one tool for a job. The job remembers the process so cancelling always hits the current step.
function runTool(job, exe, args, { cwd, onLine } = {}) {
  return new Promise((resolve, reject) => {
    if (job.cancelled) return reject(new Error('cancelled'));
    const proc = spawn(exe, args, { windowsHide: true, env: childEnv(), cwd: cwd || TMP });
    job.proc = proc;
    let outBuf = '';
    let errBuf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      outBuf += d;
      const lines = outBuf.split(/\r?\n/);
      outBuf = lines.pop();
      if (onLine) lines.forEach(onLine);
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => { errBuf = (errBuf + d).slice(-8000); });
    proc.on('error', (e) => {
      job.proc = null;
      reject(Object.assign(e, { code: 'engine' }));
    });
    proc.on('close', (code) => {
      job.proc = null;
      if (outBuf && onLine) onLine(outBuf);
      if (code === 0) return resolve();
      reject(Object.assign(new Error(lastErrorLine(errBuf) || `exited with code ${code}`), { code: classifyError(errBuf), detail: errBuf.slice(-400), exitCode: code }));
    });
  });
}

function moveFile(from, to) {
  fs.rmSync(to, { force: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(from, to);
    fs.rmSync(from);
  }
}

function findIn(dir, test) {
  const name = fs.readdirSync(dir).find(test);
  return name ? path.join(dir, name) : null;
}

/* ---------- finishing: H.264 conversion and subtitles ---------- */

function probe(file) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-protocol_whitelist', 'file', '-show_entries', 'format=duration:stream=codec_type,codec_name,pix_fmt,r_frame_rate,avg_frame_rate', '-of', 'json', file];
    const proc = spawn(FFPROBE, args, { windowsHide: true });
    let out = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('error', reject);
    proc.on('close', () => {
      try {
        const data = JSON.parse(out);
        const stream = (type) => data.streams.find((s) => s.codec_type === type) || {};
        const video = stream('video');
        const rate = (text) => {
          const [num, den] = String(text || '').split('/').map(Number);
          return num && den ? num / den : 0;
        };
        const peak = rate(video.r_frame_rate);
        const average = rate(video.avg_frame_rate);
        resolve({
          duration: Number(data.format.duration) || 0,
          video: video.codec_name || '',
          audio: stream('audio').codec_name || '',
          pixelFormat: video.pix_fmt || '',
          average,
          variable: Boolean(peak && average && Math.abs(peak - average) / peak > 0.01),
        });
      } catch (e) {
        reject(Object.assign(e, { code: 'engine' }));
      }
    });
  });
}

const ENCODERS = {
  h264_nvenc: ['-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0'],
  h264_qsv: ['-preset', 'medium', '-global_quality', '20'],
  h264_amf: ['-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20'],
  libx264: ['-preset', 'fast', '-crf', '18'],
};

// A graphics card turns a 4K conversion from hours into minutes, so use one if it can really encode 4K.
let hardwareEncoder = null;
function detectEncoder() {
  if (hardwareEncoder) return hardwareEncoder;
  const test = (name) => new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=3840x2160:r=30',
      '-frames:v', '3', '-pix_fmt', 'yuv420p', '-c:v', name, '-f', 'null', '-'], { windowsHide: true });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
  hardwareEncoder = (async () => {
    for (const name of ['h264_nvenc', 'h264_qsv', 'h264_amf']) {
      if (await test(name)) return name;
    }
    return 'libx264';
  })();
  return hardwareEncoder;
}

function shiftSrt(text, start, end) {
  const stamp = /(\d+):(\d\d):(\d\d),(\d{3})/;
  const toSec = (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
  const toStamp = (sec) => {
    const ms = Math.round(sec * 1000);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  const length = end - start;
  const out = [];
  for (const block of text.replace(/^\uFEFF/, '').split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at].split('-->');
    const ma = a.match(stamp);
    const mb = b.match(stamp);
    if (!ma || !mb) continue;
    const from = toSec(ma) - start;
    const to = toSec(mb) - start;
    if (to <= 0 || from >= length) continue;
    out.push(`${out.length + 1}\n${toStamp(Math.max(0, from))} --> ${toStamp(Math.min(length, to))}\n${lines.slice(at + 1).join('\n')}`);
  }
  return `${out.join('\n\n')}\n`;
}

// Fetches a subtitle track as SRT into the job's temp folder, trimmed to the requested range.
async function fetchSubtitle(job, lang, range, nameTemplate) {
  await runTool(job, YTDLP, [
    ...commonArgs(job), '--skip-download', '--write-subs', '--write-auto-subs',
    '--sub-langs', lang, '--convert-subs', 'srt', '-P', job.tmp, '-o', nameTemplate, '--', job.url,
  ]);
  const file = findIn(job.tmp, (n) => n.endsWith('.srt'));
  if (!file) throw Object.assign(new Error('no subtitle file'), { code: 'nosubs' });
  if (range) {
    const trimmed = shiftSrt(fs.readFileSync(file, 'utf8'), range.start, range.end);
    if (!trimmed.includes('-->')) throw Object.assign(new Error('no subtitles in this range'), { code: 'nosubs' });
    fs.writeFileSync(file, trimmed);
  }
  return file;
}

async function encodeFinal(job, encoder, opts) {
  const { burn, encodeVideo, encodeAudio, embed, duration, input, output, frameRate, pro, preset } = opts;
  // A downloaded file can claim to be a playlist; the whitelist stops ffmpeg following it elsewhere.
  const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-protocol_whitelist', 'file', '-i', input];
  if (embed) args.push('-protocol_whitelist', 'file', '-i', 'kdsub.srt');
  args.push('-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0');
  if (embed) args.push('-map', '1:0', '-c:s', output.endsWith('.mkv') ? 'srt' : 'mov_text');
  if (encodeVideo) {
    const style = "FontName=Arial,FontSize=20,Outline=2,Shadow=0,MarginV=28";
    // A preset fills the frame and crops the middle; subtitles are burned after the crop so they stay in view.
    const fit = preset ? `scale=${preset.w}:${preset.h}:force_original_aspect_ratio=increase,crop=${preset.w}:${preset.h}` : '';
    const filters = [fit, burn ? `subtitles=kdsub.srt:force_style='${style}'` : '', `format=${pro ? pro.pixels : 'yuv420p'}`].filter(Boolean).join(',');
    const codec = pro ? pro.args : ['-c:v', encoder, ...ENCODERS[encoder], '-profile:v', 'high'];
    // Premiere handles constant frame rate far better than the variable rate some sites use.
    args.push('-vf', filters, ...codec, '-fps_mode', 'cfr');
    if (frameRate) args.push('-r', String(frameRate));
  } else {
    args.push('-c:v', 'copy');
  }
  if (pro) args.push('-c:a', 'pcm_s16le', '-ar', '48000');
  else args.push(...(encodeAudio ? ['-c:a', 'aac', '-b:a', '320k', '-ar', '48000'] : ['-c:a', 'copy']));
  if (/\.(mp4|mov)$/.test(output)) args.push('-movflags', '+faststart');
  args.push('-progress', 'pipe:1', output);
  await runTool(job, FFMPEG, args, {
    cwd: job.tmp,
    onLine: (line) => {
      const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
      if (m && duration) job.percent = Math.min(99, (Number(m[1]) / 1e6 / duration) * 100);
    },
  });
}

async function finishVideo(job, source) {
  const { option } = job;
  const info = await probe(source);
  const burn = option.subs?.mode === 'burn';
  const embed = option.subs?.mode === 'embed';
  const pro = PRO_FORMATS[option.edit] || null;
  const preset = PRESETS[option.preset] || null;
  // Premiere only behaves with 8-bit 4:2:0 at a constant frame rate, even when the codec is already H.264.
  const encodeVideo = Boolean(pro) || Boolean(preset) || burn || (option.edit && (info.video !== 'h264' || info.pixelFormat !== 'yuv420p' || info.variable));
  const encodeAudio = Boolean((option.edit || preset) && info.audio && info.audio !== 'aac');
  const extension = path.extname(source);
  let finalExtension = extension;
  if (pro) finalExtension = '.mov';
  else if (encodeVideo || option.edit) finalExtension = '.mp4';
  else if (embed && !['.mp4', '.mkv'].includes(extension)) finalExtension = '.mkv';
  const finalPath = path.join(job.out, `${path.basename(source, extension)}${finalExtension}`);

  if (option.subs) {
    job.stage = 'subs';
    job.percent = 0;
    const sub = option.subs.source === 'whisper'
      ? await transcribeFile(job, source, option.subs.lang, option.subs.model)
      : await fetchSubtitle(job, option.subs.lang, option.range, 'kdsub');
    if (option.subs.translateTo) {
      // The original transcript is kept beside the video; the translated one goes into it.
      const keep = path.join(job.out, `${path.basename(source, path.extname(source))} ${option.subs.lang}.srt`);
      fs.copyFileSync(sub, keep);
      const translated = await translateSrtFile(job, sub, option.subs.lang, option.subs.translateTo);
      fs.renameSync(translated, path.join(job.tmp, 'kdsub.srt'));
      fs.rmSync(sub, { force: true });
    } else fs.renameSync(sub, path.join(job.tmp, 'kdsub.srt'));
  }
  if (!encodeVideo && !encodeAudio && !embed && finalExtension === extension) {
    moveFile(source, finalPath);
    return finalPath;
  }

  // Short fixed names keep the subtitle filter and Arabic titles out of ffmpeg's escaping rules.
  const input = `source${extension}`;
  const output = `output${path.extname(finalPath)}`;
  fs.renameSync(source, path.join(job.tmp, input));
  job.stage = 'convert';
  job.percent = 0;
  job.speed = 0;
  job.eta = 0;
  const encoder = encodeVideo && !pro ? await detectEncoder() : 'libx264';
  const frameRate = info.variable ? Math.round(info.average * 1000) / 1000 : 0;
  const opts = { burn, encodeVideo, encodeAudio, embed, duration: info.duration, input, output, frameRate, pro, preset };
  try {
    await encodeFinal(job, encoder, opts);
  } catch (e) {
    if (job.cancelled || !encodeVideo || pro || encoder === 'libx264') throw e;
    job.percent = 0;
    await encodeFinal(job, 'libx264', opts);
  }
  moveFile(path.join(job.tmp, output), finalPath);
  return finalPath;
}

async function downloadMedia(job) {
  await runTool(job, YTDLP, buildArgs(job), { onLine: (l) => handleLine(job, l) });
  if (!needsFinishing(job.option)) return;
  if (!job.file) throw Object.assign(new Error('no output file'), { code: 'engine' });
  const source = job.file;
  job.file = '';
  job.file = await finishVideo(job, source);
}

async function downloadThumbnail(job) {
  await runTool(job, YTDLP, [
    ...commonArgs(job), '--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg',
    '-P', job.tmp, '-o', '%(title).140B [%(id)s]', '--', job.url,
  ]);
  const file = findIn(job.tmp, (n) => /\.(jpe?g|png|webp)$/i.test(n));
  if (!file) throw Object.assign(new Error('no thumbnail'), { code: 'unavailable' });
  job.file = path.join(job.out, path.basename(file));
  moveFile(file, job.file);
}

function clockTag(sec) {
  const whole = Math.floor(sec + 0.001);
  const tenth = Math.floor((sec - whole) * 10 + 0.001);
  return `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, '0')}${tenth ? `.${tenth}` : ''}s`;
}

// Downloads one second of the best video from that moment, cut exactly there, and keeps its first frame.
async function downloadFrame(job) {
  const { time } = job.option;
  await runTool(job, YTDLP, [
    ...commonArgs(job), '--no-quiet', '--newline',
    '-f', 'bv*/b', '-S', `res:${MAX_HEIGHT},fps,hdr:sdr`,
    '--download-sections', `*${time}-${time + 1}`, '--force-keyframes-at-cuts',
    '--print', 'after_move:OXDONE|%(filepath)s',
    '-P', job.tmp, '-o', `%(title).130B [%(id)s] frame ${clockTag(time)}.%(ext)s`, '--', job.url,
  ], { onLine: (l) => handleLine(job, l) });
  if (!job.file) throw Object.assign(new Error('no frame'), { code: 'unavailable' });
  const source = job.file;
  job.file = '';
  job.stage = 'process';
  fs.renameSync(source, path.join(job.tmp, `source${path.extname(source)}`));
  await runTool(job, FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file',
    '-i', `source${path.extname(source)}`, '-frames:v', '1', '-update', '1', 'frame.png'], { cwd: job.tmp });
  job.file = path.join(job.out, `${path.basename(source, path.extname(source))}.png`);
  moveFile(path.join(job.tmp, 'frame.png'), job.file);
}

/* ---------- plain files: anything a browser would save, fetched in parallel pieces ---------- */

const UNITS = { B: 1, KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776 };
const toBytes = (n, unit) => Math.round(Number(n) * (UNITS[unit] || 1));
function etaSeconds(text) {
  const m = String(text || '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
}

// Picks a name that doesn't overwrite another download, unless the user asked to redo this one.
function freeName(dir, name, force) {
  const target = path.join(dir, name);
  if (force || !fs.existsSync(target)) return target;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return target;
}

const ARIA2_ERRORS = { 3: 'unavailable', 4: 'unavailable', 9: 'disk', 24: 'login', 22: 'network', 19: 'network', 6: 'network', 2: 'network' };

// One ordinary request streamed to disk, the way a browser saves a file.
async function simpleDownload(job, dir) {
  for (const n of fs.readdirSync(dir)) fs.rmSync(path.join(dir, n), { force: true });
  const controller = new AbortController();
  job.proc = { exitCode: null, pid: 0, kill: () => controller.abort() };
  let res;
  // Some hosts refuse a foreign Referer, others refuse none: try the page, then nothing, then the file's own site.
  const referers = [...new Set([job.option.referer || '', '', (() => { try { return new URL(job.url).origin + '/'; } catch { return ''; } })()])];
  for (const referer of referers) {
    try {
      res = await fetch(job.url, { headers: { 'User-Agent': BROWSER_UA, ...(referer ? { Referer: referer } : {}), ...(job.option.cookie ? { Cookie: job.option.cookie } : {}) }, signal: controller.signal, redirect: 'follow' });
    } catch (e) {
      job.proc = null;
      throw Object.assign(new Error(e.message), { code: job.cancelled ? 'cancelled' : 'network' });
    }
    if (res.ok || ![401, 403].includes(res.status)) break;
  }
  if (!res.ok || !res.body) {
    job.proc = null;
    // 405: the page sent this file with a POST form; a plain request can never get it, so retrying is pointless.
    // Any other 4xx (400 for a one-time token, 410, 451) is the site's final answer; only 429 and 5xx deserve a retry.
    throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status === 404 || res.status === 410 ? 'unavailable' : res.status === 401 ? 'login' : res.status === 405 ? 'method' : res.status === 429 ? 'ratelimit' : res.status >= 400 && res.status < 500 ? 'refused' : 'network' });
  }
  const disposition = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(res.headers.get('content-disposition') || '');
  const fromUrl = decodeURIComponent((new URL(res.url || job.url).pathname.split('/').pop() || 'download').slice(0, 150));
  const name = (job.option.name || (disposition && decodeURIComponent(disposition[1])) || fromUrl || 'download').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim() || 'download';
  job.total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(path.join(dir, name));
  let got = 0;
  const started = Date.now();
  try {
    for await (const chunk of res.body) {
      if (job.cancelled) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
      out.write(chunk);
      got += chunk.length;
      job.percent = job.total ? Math.min(99, (got / job.total) * 100) : 0;
      job.speed = Math.round(got / Math.max(0.5, (Date.now() - started) / 1000));
    }
  } finally {
    await new Promise((r) => out.end(r));
    job.proc = null;
  }
}

// When the full-size file is refused or gone, an image job falls back to the smaller copy the search page showed.
// Some hosts answer 200 with a login or redirect page instead of the picture; that is a refusal too.
function savedAWebPage(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(512);
    const n = fs.readSync(fd, head, 0, 512, 0);
    fs.closeSync(fd);
    return /^\s*<(!doctype|html|head|script|meta)/i.test(head.toString('utf8', 0, n));
  } catch { return false; }
}

// File types whose first bytes are fixed, and the names that should never hold a web page.
const MAGIC = { gz: '1f8b', tgz: '1f8b', zip: '504b', docx: '504b', xlsx: '504b', pptx: '504b', apk: '504b', jar: '504b', pdf: '25504446', rar: '526172', '7z': '377abcaf', png: '89504e47', jpg: 'ffd8ff', jpeg: 'ffd8ff', gif: '474946', mp3: null, mp4: null, exe: '4d5a', msi: 'd0cf11e0' };
const BINARY_EXT = /\.(gz|tgz|zip|rar|7z|tar|bz2|xz|sql|csv|json|xml|exe|msi|dmg|iso|pkg|pdf|docx?|xlsx?|pptx?|mp4|mkv|mov|avi|webm|mp3|wav|flac|m4a|aac|jpe?g|png|gif|webp|psd|ai|prproj|aep|mogrt|ttf|otf|apk|bin|bak|dump)$/i;
const ext = (name) => (String(name || '').match(/\.([a-z0-9]{1,5})$/i) || [, ''])[1].toLowerCase();

// A saved file whose name promises a download but whose bytes are a web page is an error page wearing the file's
// name (phpMyAdmin says "Missing parameter", cPanel shows its login, a share link shows "expired"). Such a file
// must never count as a success: it is deleted and the job fails with its own code.
function verifySavedFile(job) {
  const name = path.basename(job.file || '');
  if (!job.file || !BINARY_EXT.test(name) && !BINARY_EXT.test(job.option.name || '')) return;
  const fd = fs.openSync(job.file, 'r');
  const head = Buffer.alloc(512);
  const n = fs.readSync(fd, head, 0, 512, 0);
  fs.closeSync(fd);
  const hex = head.toString('hex', 0, Math.min(n, 8));
  const text = head.toString('utf8', 0, n);
  const magic = MAGIC[ext(name)] || MAGIC[ext(job.option.name)];
  const html = /^\s*(﻿)?<(!doctype|html|head|body|script|meta|title|div)/i.test(text) || /^\s*<\?xml[^>]*>\s*<(!doctype|html)/i.test(text);
  const wrongMagic = magic && n >= 4 && !hex.startsWith(magic);
  if (!html && !wrongMagic) return;
  fs.rmSync(job.file, { force: true });
  job.file = '';
  const what = html ? 'a web page' : `${n} bytes that are not a ${ext(name) || ext(job.option.name)} file`;
  throw Object.assign(new Error(`The site sent ${what} instead of ${name}.`), { code: 'html-instead-of-file' });
}

// Before downloading what the browser extension captured, one request for the headers only: if the site now
// answers with a page where Chrome got a file (a form export, a one-time link), stop before saving anything.
async function expectHeaders(job) {
  const expect = job.option.expect;
  if (!expect) return;
  const controller = new AbortController();
  let res;
  try {
    res = await fetch(job.url, { headers: { 'User-Agent': BROWSER_UA, ...(job.option.referer ? { Referer: job.option.referer } : {}), ...(job.option.cookie ? { Cookie: job.option.cookie } : {}) }, signal: controller.signal, redirect: 'follow' });
  } catch { return; } // the real download reports network problems with their own codes
  finally { setTimeout(() => controller.abort(), 0); }
  const type = String(res.headers.get('content-type') || '').toLowerCase();
  const chromeType = String(expect.contentType || '').toLowerCase();
  const htmlNow = /text\/html|application\/xhtml/.test(type);
  const htmlThen = /text\/html|application\/xhtml/.test(chromeType);
  if (htmlNow && !htmlThen) throw Object.assign(new Error(`The site answers with a web page now (${type.split(';')[0]}); the browser got ${chromeType.split(';')[0] || 'a file'}.`), { code: 'html-instead-of-file' });
  if (expect.disposition && !res.headers.get('content-disposition')) throw Object.assign(new Error('The site no longer sends this as a file download; the browser got a Content-Disposition header, this request did not.'), { code: 'html-instead-of-file' });
}

async function downloadFile(job) {
  const imageJob = Boolean(job.option.fallbackUrl);
  const check = (code) => {
    if (imageJob && job.file && savedAWebPage(job.file)) {
      fs.rmSync(job.file, { force: true });
      job.file = '';
      throw Object.assign(new Error('The site sent a web page instead of the picture.'), { code });
    }
  };
  try {
    await expectHeaders(job);
    await downloadFileOnce(job);
    check('refused');
    verifySavedFile(job);
  } catch (e) {
    const fallback = job.option.fallbackUrl;
    if (job.cancelled || !fallback || fallback === job.url || !['refused', 'login', 'unavailable', 'network'].includes(e.code)) throw e;
    job.url = fallback;
    job.option.referer = '';
    job.extra = 'smaller copy: the full size was refused';
    await downloadFileOnce(job);
    check('unavailable');
  }
}

async function downloadFileOnce(job) {
  const { option } = job;
  const dir = path.join(FILES, crypto.createHash('sha1').update(job.url).digest('hex').slice(0, 16));
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    '--dir', dir, '--continue=true', '--disable-ipv6=true', '--auto-save-interval=1', '--max-connection-per-server=16', '--split=16', '--min-split-size=1M',
    '--file-allocation=none', '--auto-file-renaming=false', '--allow-overwrite=true', '--remote-time=true',
    '--content-disposition-default-utf8=true', '--max-tries=5', '--retry-wait=3', '--connect-timeout=20', '--timeout=60',
    '--summary-interval=1', '--console-log-level=warn', '--download-result=hide', '--user-agent', BROWSER_UA,
    ...(cookieState.count && fs.existsSync(BROWSER_COOKIES) ? ['--load-cookies', BROWSER_COOKIES] : []),
  ];
  if (option.name) args.push('--out', option.name);
  if (option.referer) args.push('--referer', option.referer);
  if (option.cookie) args.push(`--header=Cookie: ${option.cookie}`);
  args.push('--', job.url);
  job.stage = 'download';
  try {
    await runTool(job, ARIA2, args, {
      onLine: (line) => {
        const m = line.match(/\[#\w+ ([\d.]+)(\w+)\/([\d.]+)(\w+)\((\d+)%\)(?: CN:\d+)?(?: DL:([\d.]+)(\w+))?(?: ETA:(\S+?))?\]/);
        if (!m) return;
        job.percent = Number(m[5]);
        job.total = toBytes(m[3], m[4]);
        job.speed = m[6] ? toBytes(m[6], m[7]) : 0;
        job.eta = etaSeconds(m[8]);
      },
    });
  } catch (e) {
    if (e.code === 'unknown' || !e.code) e.code = ARIA2_ERRORS[e.exitCode] || 'network';
    if (job.cancelled || ['disk', 'login', 'refused', 'method'].includes(e.code)) throw e;
    // Some hosts refuse aria2's ranged, multi-connection requests, or answer 404 to a request without the right
    // Referer; a plain single request with the Referer variants usually works. If it fails the same way, say so.
    try { await simpleDownload(job, dir); } catch (e2) { throw e2.code === 'network' && e.code === 'unavailable' ? e : e2; }
  }
  const name = fs.readdirSync(dir).find((n) => !n.endsWith('.aria2'));
  if (!name) throw Object.assign(new Error('no file'), { code: 'unavailable' });
  job.title = name;
  job.file = freeName(job.out, name, job.force);
  moveFile(path.join(dir, name), job.file);
  fs.rm(dir, { recursive: true, force: true }, () => {});
}

/* ---------- speech to text (whisper.cpp, on this PC) ---------- */

function nvidiaInfo() {
  const r = require('child_process').spawnSync('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  if (r.status !== 0 || !r.stdout) return null;
  const [name, driver] = r.stdout.trim().split(',').map((x) => x.trim());
  return { name, driver, cuda12: parseFloat(driver) >= 551 };
}

const whisperBinary = () => (fs.existsSync(WHISPER_CUDA) && nvidiaInfo() ? WHISPER_CUDA : WHISPER);

// Downloads and unpacks the CUDA build as a job, so the window shows its progress like any download.
async function installGpuWhisper(job) {
  const zip = path.join(job.tmp, 'whisper-cuda.zip');
  job.stage = 'download';
  await runTool(job, ARIA2, ['--dir', job.tmp, '--out', 'whisper-cuda.zip', '--disable-ipv6=true', '--max-connection-per-server=16', '--split=16', '--min-split-size=1M',
    '--file-allocation=none', '--allow-overwrite=true', '--summary-interval=1', '--console-log-level=warn', '--download-result=hide', '--max-tries=5', '--retry-wait=3', '--', WHISPER_CUDA_URL],
  { onLine: (line) => { const m = line.match(/\((\d+)%\)(?: CN:\d+)?(?: DL:([\d.]+)(\w+))?/); if (m) { job.percent = Number(m[1]); job.speed = m[2] ? toBytes(m[2], m[3]) : 0; } } });
  job.stage = 'process';
  const unpacked = path.join(job.tmp, 'unpacked');
  fs.mkdirSync(unpacked, { recursive: true });
  await runTool(job, 'tar.exe', ['-xf', zip, '-C', unpacked]);
  const found = (function find(dir) { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (n.toLowerCase() === 'whisper-cli.exe') return dir; if (fs.statSync(p).isDirectory()) { const r = find(p); if (r) return r; } } return null; }(unpacked));
  if (!found) throw Object.assign(new Error('whisper-cli.exe not in the archive'), { code: 'engine' });
  fs.rmSync(WHISPER_CUDA_DIR, { recursive: true, force: true });
  fs.renameSync(found, WHISPER_CUDA_DIR);
  job.file = WHISPER_CUDA;
  job.title = 'GPU speech engine';
}

async function ensureModel(job, key) {
  const model = WHISPER_MODELS[key] || WHISPER_MODELS.turbo;
  const file = path.join(MODELS, model.file);
  if (fs.existsSync(file) && fs.statSync(file).size === model.size) return file;
  fs.mkdirSync(MODELS, { recursive: true });
  job.stage = 'model';
  job.percent = 0;
  await runTool(job, ARIA2, [
    '--dir', MODELS, '--out', `${model.file}.part`, '--continue=true', '--disable-ipv6=true', '--auto-save-interval=1',
    '--max-connection-per-server=16', '--split=16', '--min-split-size=1M', '--file-allocation=none', '--allow-overwrite=true',
    '--summary-interval=1', '--console-log-level=warn', '--download-result=hide', '--max-tries=5', '--retry-wait=3',
    '--', `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.file}`,
  ], { onLine: (line) => { const m = line.match(/\((\d+)%\)(?: CN:\d+)?(?: DL:([\d.]+)(\w+))?/); if (m) { job.percent = Number(m[1]); job.speed = m[2] ? toBytes(m[2], m[3]) : 0; } } });
  if (fs.statSync(path.join(MODELS, `${model.file}.part`)).size !== model.size) throw Object.assign(new Error('model download incomplete'), { code: 'network' });
  fs.renameSync(path.join(MODELS, `${model.file}.part`), file);
  return file;
}

// Turns any media file into an SRT with whisper.cpp. Arabic needs the turbo model to be usable.
async function transcribeFile(job, source, lang, modelKey) {
  const model = await ensureModel(job, modelKey);
  const wav = path.join(job.tmp, 'speech.wav');
  job.stage = 'process';
  await runTool(job, FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  job.stage = 'transcribe';
  job.percent = 0;
  const threads = Math.max(2, Math.min(12, os.cpus().length - 2));
  const args = ['-m', model, '-l', WHISPER_LANGS.includes(lang) ? lang : 'auto', '-t', String(threads), '-osrt', '-of', path.join(job.tmp, 'speech'), '-pp', '-np', '-ml', '84', '-sow', '-bs', '5', '-f', wav];
  const binary = whisperBinary();
  try {
    await runTool(job, binary, args, { onLine: (line) => { const m = line.match(/progress\s*=\s*(\d+)%/); if (m) job.percent = Math.min(99, Number(m[1])); } });
  } catch (e) {
    // A GPU build that cannot start (old driver, missing DLL) must not stop the work.
    if (binary === WHISPER || job.cancelled) throw e;
    job.percent = 0;
    await runTool(job, WHISPER, args, { onLine: (line) => { const m = line.match(/progress\s*=\s*(\d+)%/); if (m) job.percent = Math.min(99, Number(m[1])); } });
  }
  const srt = path.join(job.tmp, 'speech.srt');
  if (!fs.existsSync(srt) || !fs.readFileSync(srt, 'utf8').includes('-->')) throw Object.assign(new Error('no speech found'), { code: 'nosubs' });
  return srt;
}

// A transcript as its own job: the audio is fetched (and cut) first, then written as SRT beside the video files.
// Writes a translated copy of an SRT next to the original, keeping the timing.
async function translateSrtFile(job, srtPath, from, to) {
  job.stage = 'translate';
  job.percent = 0;
  const text = fs.readFileSync(srtPath, 'utf8');
  const out = await translate.translateSrt(text, from === 'auto' ? 'auto' : from, to, (p) => { job.percent = Math.min(99, p * 100); });
  const target = srtPath.replace(/(\.[a-z]{2,4})?\.srt$/i, `${to === from ? '' : `.${to}`}.srt`).replace(/\.srt$/, '.srt');
  const file = target === srtPath ? srtPath.replace(/\.srt$/, `.${to}.srt`) : target;
  fs.writeFileSync(file, out);
  return file;
}

async function downloadTranscript(job) {
  const { lang, model, range } = job.option;
  const args = [...commonArgs(job), '--no-quiet', '--newline', '-f', 'ba/b', '-x', '--audio-format', 'wav',
    '--postprocessor-args', 'ffmpeg:-ac 1 -ar 16000', '--print', 'after_move:OXDONE|%(filepath)s', '--print', 'video:OXTITLE|%(id)s|%(title)s', '--no-simulate',
    '-P', job.tmp, '-o', `%(title).140B [%(id)s]${rangeTag(range)}.%(ext)s`];
  if (range) args.push('--download-sections', `*${range.start}-${range.end}`, '--force-keyframes-at-cuts');
  args.push('--', job.url);
  await runTool(job, YTDLP, args, { onLine: (l) => handleLine(job, l) });
  if (!job.file) throw Object.assign(new Error('no audio'), { code: 'engine' });
  const audio = job.file;
  job.file = '';
  const srt = await transcribeFile(job, audio, lang, model);
  job.file = path.join(job.out, `${path.basename(audio, path.extname(audio))} ${lang === 'auto' ? 'ai' : lang}.srt`);
  moveFile(srt, job.file);
  if (job.option.translateTo) job.extra = await translateSrtFile(job, job.file, lang, job.option.translateTo);
}

async function downloadSubtitle(job) {
  const { lang, range } = job.option;
  const file = await fetchSubtitle(job, lang, range, `%(title).140B [%(id)s]${rangeTag(range)}`);
  job.file = path.join(job.out, path.basename(file));
  moveFile(file, job.file);
  if (job.option.translateTo) job.extra = await translateSrtFile(job, job.file, lang, job.option.translateTo);
}

function pump() {
  const running = [...jobs.values()].filter((j) => j.status === 'running').length;
  let free = MAX_CONCURRENT - running;
  for (const job of jobs.values()) {
    if (free <= 0) break;
    // A job waiting for its retry time stays queued but is not started yet.
    if (job.status === 'queued' && !(job.notBefore > Date.now())) {
      startJob(job);
      free -= 1;
    }
  }
  pruneJobs();
  saveQueue();
}

// Connection problems get three more tries, spaced out, before a job is given up.
const RETRY_CODES = new Set(['network', 'ratelimit', 'unknown']);
const RETRY_DELAYS = [10000, 30000, 60000];

// Stock clips can be converted for the timeline, or get a small proxy beside them, after they are saved.
async function finishClip(job) {
  const source = job.file;
  if (job.option.edit) {
    job.file = '';
    const converted = await finishVideo(job, source);
    job.file = converted;
  }
  if (job.option.proxy) {
    job.stage = 'proxy';
    job.percent = 0;
    const dir = path.join(job.out, 'Proxies');
    fs.mkdirSync(dir, { recursive: true });
    const proxy = path.join(dir, `${path.basename(job.file, path.extname(job.file))}.mp4`);
    const info = await probe(job.file).catch(() => ({ duration: 0 }));
    await runTool(job, FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-protocol_whitelist', 'file', '-i', job.file, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'scale=-2:540,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-progress', 'pipe:1', proxy], {
      onLine: (line) => { const m = line.match(/^out_time_(?:us|ms)=(\d+)/); if (m && info.duration) job.percent = Math.min(99, (Number(m[1]) / 1e6 / info.duration) * 100); },
    });
    job.extra = `${job.extra ? `${job.extra} · ` : ''}proxy in Proxies`;
  }
}

function pruneJobs() {
  const finished = [...jobs.values()].filter((j) => !['queued', 'running'].includes(j.status));
  for (const j of finished.slice(0, Math.max(0, finished.length - MAX_KEPT_JOBS))) jobs.delete(j.id);
}

async function startJob(job) {
  job.status = 'running';
  job.stage = 'prepare';
  try {
    fs.mkdirSync(job.out, { recursive: true });
    fs.mkdirSync(job.tmp, { recursive: true });
    if (job.option.kind === 'thumbnail') await downloadThumbnail(job);
    else if (job.option.kind === 'subtitle') await downloadSubtitle(job);
    else if (job.option.kind === 'frame') await downloadFrame(job);
    else if (job.option.kind === 'file') { await downloadFile(job); if (job.option.edit || job.option.proxy) await finishClip(job); }
    else if (job.option.kind === 'transcribe') await downloadTranscript(job);
    else if (job.option.kind === 'gpu-whisper') await installGpuWhisper(job);
    else await downloadMedia(job);
    job.status = 'done';
    job.stage = 'process';
    job.percent = 100;
    addHistory(job);
  } catch (e) {
    // Sites break yt-dlp often and a fresh engine usually fixes it, so update once and try again.
    if (!job.cancelled && e.code === 'engine' && !job.retried) {
      job.retried = true;
      job.stage = 'update';
      job.percent = 0;
      await startUpdate();
      if (!job.cancelled && updateState.ok) {
        fs.rmSync(job.tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
        Object.assign(job, { status: 'queued', stage: 'prepare', file: '', pass: 0, proc: null });
        pump();
        return;
      }
    }
    // Dropped connections and busy sites: wait, then try again, keeping any partial file.
    if (!job.cancelled && RETRY_CODES.has(e.code || 'unknown') && (job.attempts || 0) < RETRY_DELAYS.length) {
      job.attempts = (job.attempts || 0) + 1;
      const delay = RETRY_DELAYS[job.attempts - 1];
      Object.assign(job, { status: 'queued', stage: 'retry', percent: 0, speed: 0, eta: 0, proc: null, file: '', notBefore: Date.now() + delay, extra: `retry ${job.attempts} of ${RETRY_DELAYS.length} in ${delay / 1000}s (${e.message.slice(0, 80)})` });
      setTimeout(pump, delay + 100);
      saveQueue();
      return;
    }
    // A pasted or captured link that no site extractor knows is probably a plain file.
    if (!job.cancelled && job.fallbackToFile && job.option.kind === 'video' && !['login', 'drm', 'disk', 'ratelimit'].includes(e.code)) {
      fs.rmSync(job.tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
      job.option = { kind: 'file', name: '', referer: '' };
      job.label = jobLabel(job.option);
      job.key = '';
      Object.assign(job, { status: 'queued', stage: 'prepare', file: '', pass: 0, proc: null, fallbackToFile: false });
      pump();
      return;
    }
    if (job.cancelled) {
      job.status = 'cancelled';
    } else {
      job.status = 'error';
      job.error = e.message;
      job.errorCode = e.code || 'unknown';
    }
  }
  job.speed = 0;
  job.eta = 0;
  job.proc = null;
  cleanupTmp(job);
  pump();
}

function validRange(range) {
  if (!range || typeof range !== 'object') return null;
  const start = Number(range.start);
  const end = Number(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 1e7) return null;
  return { start, end };
}

const validLang = (lang) => typeof lang === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,24}$/.test(lang);

function validOption(option) {
  if (!option || typeof option !== 'object') return null;
  const range = option.range ? validRange(option.range) : null;
  if (option.range && !range) return null;
  if (option.kind === 'audio' && Object.prototype.hasOwnProperty.call(AUDIO, option.format)) {
    return { kind: 'audio', format: option.format, range };
  }
  if (option.kind === 'thumbnail') return { kind: 'thumbnail' };
  if (option.kind === 'file') {
    const name = String(option.name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim().slice(0, 150);
    // The browser extension sends the page's cookies for links that only work while logged in (cPanel, Drive, intranets).
    const cookie = typeof option.cookie === 'string' ? option.cookie.replace(/[\r\n\u0000-\u001f]/g, '').trim().slice(0, 16384) : '';
    // What the browser saw for this download, so the helper can refuse a page that replaced the file.
    const expect = option.expect && typeof option.expect === 'object'
      ? { contentType: String(option.expect.contentType || '').slice(0, 200), disposition: String(option.expect.disposition || '').slice(0, 500) }
      : null;
    return { kind: 'file', name: /^\.+$/.test(name) ? '' : name, referer: validUrl(option.referer) || '', ...(cookie && cookie.includes('=') ? { cookie } : {}), ...(expect && (expect.contentType || expect.disposition) ? { expect } : {}) };
  }
  const time = Number(option.time);
  if (option.kind === 'frame' && Number.isFinite(time) && time >= 0 && time <= 1e7) return { kind: 'frame', time: Math.round(time * 10) / 10 };
  const translateTo = TRANSLATE_LANGS.includes(option.translateTo) ? option.translateTo : '';
  if (option.kind === 'subtitle' && validLang(option.lang)) return { kind: 'subtitle', lang: option.lang, range, translateTo };
  if (option.kind === 'transcribe') {
    return { kind: 'transcribe', lang: WHISPER_LANGS.includes(option.lang) ? option.lang : 'auto', model: WHISPER_MODELS[option.model] ? option.model : 'turbo', range, translateTo };
  }
  if (option.kind === 'gpu-whisper') return { kind: 'gpu-whisper' };
  const height = Number(option.height);
  if (option.kind === 'video' && Number.isInteger(height) && height > 0 && height <= MAX_HEIGHT) {
    let subs = null;
    if (option.subs) {
      if (!validLang(option.subs.lang) || !['embed', 'burn'].includes(option.subs.mode)) return null;
      subs = { lang: option.subs.lang, mode: option.subs.mode };
      if (TRANSLATE_LANGS.includes(option.subs.translateTo) && option.subs.translateTo !== option.subs.lang) subs.translateTo = option.subs.translateTo;
      if (option.subs.source === 'whisper') {
        if (!WHISPER_LANGS.includes(option.subs.lang)) return null;
        subs.source = 'whisper';
        subs.model = WHISPER_MODELS[option.subs.model] ? option.subs.model : 'turbo';
      }
    }
    const edit = option.edit === true ? 'h264' : EDIT_FORMATS.includes(option.edit) ? option.edit : null;
    if (option.edit && !edit) return null;
    const preset = PRESETS[option.preset] ? option.preset : null;
    if (option.preset && !preset) return null;
    return { kind: 'video', height, edit, subs, range, ...(preset ? { preset } : {}) };
  }
  return null;
}

function jobLabel(option) {
  const range = option.range ? ` · ${formatClock(option.range.start)}-${formatClock(option.range.end)}` : '';
  if (option.kind === 'thumbnail') return 'Thumbnail';
  if (option.kind === 'file') return 'File';
  if (option.kind === 'frame') return `Frame ${formatClock(option.time)}`;
  if (option.kind === 'subtitle') return `SRT ${option.lang}${option.translateTo ? ` → ${option.translateTo}` : ''}${range}`;
  if (option.kind === 'gpu-whisper') return 'GPU speech engine';
  const tr = option.translateTo ? ` → ${option.translateTo}` : '';
  if (option.kind === 'transcribe') return `AI subtitles ${option.lang}${tr}${range}`;
  if (option.kind === 'audio') return `${option.format.toUpperCase().replace('-', ' ')}${range}`;
  const extras = [PRESETS[option.preset] ? PRESETS[option.preset].label : '', option.edit ? (PRO_FORMATS[option.edit] ? PRO_FORMATS[option.edit].suffix : 'H.264') : '', option.subs ? `${option.subs.source === 'whisper' ? 'AI subs' : 'Subs'} ${option.subs.lang}${option.subs.translateTo ? `→${option.subs.translateTo}` : ''}` : ''].filter(Boolean);
  return `${option.height}p${extras.length ? ` · ${extras.join(' · ')}` : ''}${range}`;
}

function formatClock(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Playlist titles become folder names, so anything Windows rejects has to go.
function safeFolder(name) {
  // Up to three levels of subfolder ("Packs/olive film/03 harvest"); anything deeper is dropped.
  const parts = String(name || '').split(/[\\/]+/).filter(Boolean).slice(0, 3).map((part) => safeFolder1(part)).filter(Boolean);
  return parts.join(path.sep);
}

function safeFolder1(name) {
  const clean = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 80);
  if (!clean || /^\.+$/.test(clean)) return '';
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean) ? `_${clean}` : clean;
}

function createJob(url, title, option, extra = {}) {
  const id = crypto.randomBytes(6).toString('hex');
  const folder = safeFolder(extra.folder);
  // The base is fixed when the job is made, so switching projects later never moves a running download.
  const base = typeof extra.base === 'string' && path.isAbsolute(extra.base) ? extra.base : baseDir();
  const job = {
    id, url, option, label: jobLabel(option),
    title: String(title || url).slice(0, 200),
    videoId: String(extra.videoId || '').slice(0, 100),
    key: String(extra.key || '').slice(0, 200),
    force: extra.force === true,
    fallbackToFile: extra.fallbackToFile === true,
    folder, base,
    out: folder ? path.join(base, folder) : base,
    tmp: path.join(TMP, id),
    status: 'queued', stage: 'prepare', percent: 0, speed: 0, eta: 0, pass: 0,
    error: '', errorCode: '', file: '', proc: null, cancelled: false,
  };
  jobs.set(id, job);
  pump();
  return job;
}

function cancelJob(job) {
  if (job.status === 'queued') {
    job.status = 'cancelled';
    pump();
  } else if (job.status === 'running') {
    job.cancelled = true;
    killTree(job.proc);
  }
}

function reveal(file) {
  const target = file && fs.existsSync(file) ? ['/select,', file] : [OUT];
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn('explorer.exe', target, { windowsHide: false, detached: true, stdio: 'ignore' });
  proc.on('error', () => {});
  proc.unref();
}

const updateState = { running: false, ok: true, message: '', checked: 0 };
try {
  Object.assign(updateState, JSON.parse(fs.readFileSync(ENGINE_FILE, 'utf8')), { running: false });
} catch { /* never checked */ }

// yt-dlp downloads its own official release and checks the published SHA-256 before replacing itself.
let updating = null;
function startUpdate() {
  if (updating) return updating;
  updateState.running = true;
  updating = new Promise((resolve) => {
    const finish = (ok, message) => {
      Object.assign(updateState, { running: false, ok, message, checked: Date.now() });
      try {
        fs.writeFileSync(ENGINE_FILE, JSON.stringify({ ok, message, checked: updateState.checked }));
      } catch { /* the next start just checks again */ }
      infoCache.clear();
      updating = null;
      resolve(updateState);
    };
    const proc = spawn(YTDLP, ['--compat-options', 'no-certifi', '-U'], { windowsHide: true, env: childEnv(), cwd: TMP });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('error', (e) => finish(false, e.message));
    proc.on('close', (code) => finish(code === 0, out.trim().split(/\r?\n/).pop() || ''));
  });
  return updating;
}

// Checks once a day, and only while nothing is downloading, so a replaced engine never cuts a job short.
function autoUpdate() {
  if (Date.now() - updateState.checked < ENGINE_CHECK_EVERY) return;
  if ([...jobs.values()].some((j) => j.status === 'running')) return;
  startUpdate();
}

/* ---------- commands for the desktop app (its built-in browser) ---------- */

// Claude asks the helper, the helper hands the request to the app, the app answers from its browser.
const appCommands = new Map();
let appSeen = 0;
let commandSeq = 0;

const appOnline = () => Date.now() - appSeen < 5000;

function runInApp(type, params, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!appOnline()) return reject(Object.assign(new Error('The K Downloader app is not running. Open it from the Start menu and try again.'), { http: 503 }));
    const id = String(++commandSeq);
    const timer = setTimeout(() => {
      appCommands.delete(id);
      reject(Object.assign(new Error('The app did not answer in time.'), { http: 504 }));
    }, timeoutMs);
    appCommands.set(id, { id, type, params, taken: false, finish: (err, result) => { clearTimeout(timer); appCommands.delete(id); err ? reject(err) : resolve(result); } });
  });
}

function writeBrowserCookies(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# From the K Downloader browser. Removed when the helper stops.'];
  const hosts = new Set();
  for (const c of cookies) {
    if (!c || typeof c.name !== 'string' || typeof c.domain !== 'string') continue;
    const domain = c.domain.startsWith('.') ? c.domain : c.hostOnly ? c.domain : `.${c.domain}`;
    hosts.add(domain.replace(/^\./, ''));
    const expires = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    lines.push([(c.httpOnly ? '#HttpOnly_' : '') + domain, domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', expires, c.name, String(c.value || '')].join('\t'));
  }
  fs.writeFileSync(BROWSER_COOKIES, `${lines.join('\n')}\n`);
  Object.assign(cookieState, { count: lines.length - 2, hosts: [...hosts].sort(), at: Date.now() });
  infoCache.clear();
}

process.on('exit', () => { try { fs.rmSync(BROWSER_COOKIES, { force: true }); } catch { /* gone */ } });

/* ---------- http ---------- */

function send(res, status, body) {
  const text = JSON.stringify(body);
  // Deliberately no Access-Control-* headers: browsers must not let web pages read these replies.
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (d) => {
      size += d.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { http: 413 }));
        req.destroy();
      } else chunks.push(d);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(body && typeof body === 'object' ? body : {});
      } catch {
        reject(Object.assign(new Error('invalid json'), { http: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function validUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// The script carries the token, so a page must never be able to load it. A <script> tag is the one
// cross-origin load that could expose it: fetch and iframes can't read this reply without CORS headers.
function canLoadUserscript(req) {
  return ['document', 'empty'].includes(req.headers['sec-fetch-dest']);
}

// Hands the pairing code to the Chrome extension whose id is in the link. Only the extension's own popup
// opens this page, and only a top-level navigation can load it, like the userscript.
function sendPairPage(res, extId, auto) {
  const html = `<!doctype html><meta charset="utf-8"><title>K Downloader</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#17181b;color:#f2f3f5;font:16px 'Segoe UI',sans-serif">
<div id="m">Connecting the Chrome extension to K Downloader...</div>
<script>
const m = document.getElementById('m');
try {
  chrome.runtime.sendMessage(${JSON.stringify(extId)}, { type: 'kd-pair', token: ${JSON.stringify(TOKEN)}, port: ${PORT}, auto: ${auto ? 'true' : 'false'} }, (r) => {
    m.textContent = r && r.ok ? 'Connected. Downloads from Chrome now go through K Downloader. You can close this tab.' : 'The extension did not answer. Make sure it is enabled in chrome://extensions and try again.';
  });
} catch (e) { m.textContent = 'Open this page from the extension\\'s own Connect button.'; }
</script>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(html);
}

function sendUserscript(res) {
  const code = fs.readFileSync(USERSCRIPT, 'utf8').replace('__KD_TOKEN__', TOKEN);
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(code);
}

function authorized(req) {
  const given = Buffer.from(String(req.headers['x-kd-token'] || ''));
  const want = Buffer.from(TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

async function route(req, res) {
  // Host check blocks DNS-rebinding; the token blocks every other local or web caller.
  const hostOk = [`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.host);
  if (!hostOk) return send(res, 403, { error: 'forbidden' });

  const { pathname } = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === 'GET' && pathname === '/health') {
    return send(res, 200, { ok: true, app: 'kareem-downloader', version: VERSION });
  }
  if (req.method === 'GET' && pathname === USERSCRIPT_PATH) {
    if (!canLoadUserscript(req)) return send(res, 403, { error: 'forbidden' });
    return sendUserscript(res);
  }
  if (req.method === 'GET' && pathname === '/pair') {
    const extId = new URL(req.url, `http://${HOST}:${PORT}`).searchParams.get('ext') || '';
    if (req.headers['sec-fetch-dest'] !== 'document' || !/^[a-p]{32}$/.test(extId)) return send(res, 403, { error: 'forbidden' });
    return sendPairPage(res, extId, new URL(req.url, `http://${HOST}:${PORT}`).searchParams.get('auto') === '1');
  }
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET' && pathname === '/ping') return send(res, 200, { ok: true, out: OUT });
  if (req.method === 'GET' && pathname === '/jobs') {
    return send(res, 200, { jobs: [...jobs.values()].map((j) => publicJob(j, wantsPaths(req))).reverse() });
  }
  // One job by id, so the browser extension can watch a download it handed over and step in if it fails.
  if (req.method === 'GET' && /^\/jobs\/[a-f0-9]{6,32}$/.test(pathname)) {
    const job = jobs.get(pathname.slice(6));
    return job ? send(res, 200, publicJob(job, wantsPaths(req))) : send(res, 404, { error: 'not found' });
  }

  if (req.method === 'GET' && pathname === '/update') return send(res, 200, updateState);
  if (req.method === 'GET' && pathname === '/gpu') {
    const nv = nvidiaInfo();
    return send(res, 200, { nvidia: nv, installed: fs.existsSync(WHISPER_CUDA), active: whisperBinary() === WHISPER_CUDA, sizeBytes: 684000000 });
  }
  if (req.method === 'GET' && pathname === '/models') {
    const models = Object.entries(WHISPER_MODELS).map(([key, m]) => { const file = path.join(MODELS, m.file); return { key, name: m.name, sizeBytes: m.size, ready: fs.existsSync(file) && fs.statSync(file).size === m.size }; });
    return send(res, 200, { models, languages: WHISPER_LANGS, whisper: fs.existsSync(WHISPER) });
  }
  if (req.method === 'GET' && pathname === '/cookies') return send(res, 200, { count: cookieState.count, hosts: cookieState.hosts, at: cookieState.at });
  if (req.method === 'GET' && pathname === '/app/commands') {
    appSeen = Date.now();
    const pending = [...appCommands.values()].filter((c) => !c.taken);
    pending.forEach((c) => { c.taken = true; });
    return send(res, 200, { commands: pending.map((c) => ({ id: c.id, type: c.type, params: c.params })) });
  }
  if (req.method === 'GET' && pathname === '/images/providers') return send(res, 200, { providers: images.available({}, appOnline()) });
  if (req.method === 'GET' && pathname === '/videos/providers') return send(res, 200, { providers: videos.available(appOnline()) });
  if (req.method === 'GET' && pathname === '/projects') return send(res, 200, { root: PROJECTS, projects: listProjects(), current: currentProject(), buckets: BUCKETS, downloads: OUT });
  if (req.method === 'GET' && pathname === '/sources/health') return send(res, 200, sourceHealth);
  if (req.method === 'GET' && pathname === '/keys') {
    const keys = images.loadKeys(KEYS_FILE);
    // Only the last characters leave the helper; the window shows that a key is set, not the key.
    const masked = {};
    for (const [k, v] of Object.entries(keys)) masked[k] = v ? `••••${String(v).slice(-4)}` : '';
    return send(res, 200, { keys: masked });
  }
  if (req.method === 'GET' && pathname === '/history') {
    return send(res, 200, { entries: history.map((h) => ({ ...h, file: wantsPaths(req) ? h.file : undefined, exists: fs.existsSync(h.file) })) });
  }

  if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
  const body = await readJson(req);

  if (pathname === '/info') {
    const url = validUrl(body.url);
    if (!url) return send(res, 400, { error: 'invalid url', code: 'unsupported' });
    try {
      const info = await getInfo(url);
      return send(res, 200, { ...info, done: doneKeys(info.id) });
    } catch (e) {
      return send(res, 502, { error: e.message, code: e.code || 'unknown' });
    }
  }
  if (pathname === '/playlist') {
    const url = validUrl(body.url);
    if (!url) return send(res, 400, { error: 'invalid url', code: 'unsupported' });
    try {
      const list = await getPlaylist(url, { limit: body.limit, after: String(body.after || '').replace(/-/g, '') });
      return send(res, 200, list);
    } catch (e) {
      return send(res, 502, { error: e.message, code: e.code || 'unknown' });
    }
  }
  if (pathname === '/download') {
    const url = validUrl(body.url);
    const option = validOption(body.option);
    if (!url || !option) return send(res, 400, { error: 'invalid request' });
    // Inside a project, a plain download with no folder of its own is a reference.
    const extra = { folder: body.folder || (currentProject() ? BUCKETS.references : ''), videoId: body.videoId, key: body.key, force: body.force === true, fallbackToFile: body.fallbackToFile === true };
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url)) return send(res, 400, { error: 'invalid request' });
    // A double click must not start two jobs writing the same file.
    const inFlight = [...jobs.values()].find((j) => ['queued', 'running'].includes(j.status)
      && j.videoId && j.key && j.videoId === String(extra.videoId || '') && j.key === String(extra.key || ''));
    if (inFlight) return send(res, 200, publicJob(inFlight));
    const existing = extra.force ? null : findDownloaded(String(extra.videoId || ''), String(extra.key || ''));
    if (existing) return send(res, 409, { error: 'already downloaded', duplicate: { id: existing.id, title: existing.title, label: existing.label } });
    return send(res, 200, publicJob(createJob(url, body.title, option, extra), wantsPaths(req)));
  }
  if (pathname === '/keys') {
    const keys = images.loadKeys(KEYS_FILE);
    for (const k of ['pexels', 'pixabay', 'unsplash', 'google', 'googleCx']) {
      if (typeof body[k] !== 'string') continue;
      const value = body[k].trim();
      if (value === '') delete keys[k];
      else if (/^[\w.:-]{4,200}$/.test(value)) keys[k] = value;
    }
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
    return send(res, 200, { providers: images.available(keys) });
  }
  if (pathname === '/images/search') {
    try {
      const result = await images.search({
        query: body.query, providers: Array.isArray(body.providers) ? body.providers.filter((p) => typeof p === 'string') : null,
        page: Math.min(Math.max(Number(body.page) || 1, 1), 50), perPage: Math.min(Math.max(Number(body.perPage) || 24, 1), 50),
        orientation: ['landscape', 'portrait', 'square'].includes(body.orientation) ? body.orientation : '',
        appOnline: appOnline(), scrape: (provider, query, need) => runInApp('images.scrape', { provider, query, need }, 200000),
      });
      return send(res, 200, result);
    } catch (e) {
      return send(res, e.http || 502, { error: e.message, code: 'network' });
    }
  }
  if (pathname === '/projects/use') {
    try { return send(res, 200, { current: useProject(String(body.name || '')), root: PROJECTS }); } catch (e) { return send(res, e.http || 500, { error: e.message }); }
  }
  if (pathname === '/sources/check') return send(res, 200, await checkSources(body.all === true));
  if (pathname === '/videos/search') {
    try {
      const result = await videos.search({
        query: body.query, providers: Array.isArray(body.providers) ? body.providers.filter((p) => typeof p === 'string') : null,
        page: Math.min(Math.max(Number(body.page) || 1, 1), 50), perPage: Math.min(Math.max(Number(body.perPage) || 24, 1), 50),
        orientation: ['landscape', 'portrait', 'square'].includes(body.orientation) ? body.orientation : '',
        minDuration: Math.max(Number(body.minDuration) || 0, 0), maxDuration: Math.max(Number(body.maxDuration) || 0, 0),
        appOnline: appOnline(), scrape: (provider, query, need) => runInApp('images.scrape', { provider, query, need }, 200000),
        ytSearch: (query, need) => runInfo(`ytsearch${Math.min(Math.max(need, 1), 100)}:${query}`, ['--flat-playlist']),
      });
      return send(res, 200, result);
    } catch (e) {
      return send(res, e.http || 502, { error: e.message, code: 'network' });
    }
  }
  if (pathname === '/videos/download') {
    const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
    const quality = Object.keys(videos.QUALITIES).includes(String(body.quality)) ? String(body.quality) : 'best';
    const allReference = items.length > 0 && items.every((it) => it && videos.REFERENCE(it.provider));
    const folder = safeFolder(body.folder) || defaultFolder(allReference ? 'references' : 'footage', body.query);
    const edit = EDIT_FORMATS.includes(body.edit) ? body.edit : null;
    const proxy = body.proxy === true;
    const created = [];
    const credits = [];
    const manifest = [];
    items.forEach((item, index) => {
      if (!item || typeof item !== 'object' || !videos.PROVIDERS[item.provider] || !Array.isArray(item.files)) return;
      const clean = { ...item, title: videos.safe(item.title), author: videos.safe(item.author), license: videos.safe(item.license), pageUrl: validUrl(item.pageUrl) || '', licenseUrl: validUrl(item.licenseUrl) || '', files: item.files.filter((f) => f && validUrl(f.url) && /^https:/.test(f.url)).map((f) => ({ url: f.url, width: Number(f.width) || 0, height: Number(f.height) || 0, fps: Number(f.fps) || 0 })) };
      if (videos.REFERENCE(clean.provider)) {
        // A reference clip is someone else's video: the video engine fetches it from its page at the wanted height.
        if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be|dailymotion\.com)\//.test(clean.pageUrl)) return;
        const height = quality === 'best' ? 2160 : Number(quality);
        const option = { kind: 'video', height, ...(edit ? { edit } : {}) };
        const job = createJob(clean.pageUrl, clean.title || clean.pageUrl, option, { folder, videoId: clean.id.split(':').pop(), key: `video|${height}${edit ? `|${edit}` : ''}` });
        credits.push(`${clean.title} | ${videos.creditsLine(clean)}`);
        manifest.push({ file: clean.title, title: clean.title, author: clean.author, license: clean.license, source: clean.pageUrl, seconds: clean.duration || '', width: '', height: '', kind: 'reference video' });
        created.push(publicJob(job, wantsPaths(req)));
        return;
      }
      const file = videos.pickFile(clean, quality);
      if (!file) return;
      const name = videos.fileName(clean, file, index);
      // Smaller renditions stand in when the chosen one is refused or missing.
      const smaller = clean.files.filter((f) => f.height < file.height).sort((a, b) => b.height - a.height)[0];
      const job = createJob(file.url, name, { kind: 'file', name, referer: clean.pageUrl, fallbackUrl: smaller ? smaller.url : '', ...(edit ? { edit } : {}), ...(proxy ? { proxy } : {}) }, { folder, videoId: `clip:${clean.id}`, key: `clip|${file.height}${edit ? `|${edit}` : ''}` });
      credits.push(`${name} | ${videos.creditsLine(clean)}`);
      manifest.push({ file: name, title: clean.title, author: clean.author, license: clean.license, source: clean.pageUrl, seconds: clean.duration || '', width: file.width || '', height: file.height || '', kind: 'stock clip' });
      created.push(publicJob(job, wantsPaths(req)));
    });
    if (credits.length) {
      const dir = path.join(baseDir(), folder);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'credits.txt'), `${credits.join(os.EOL)}${os.EOL}`);
      appendManifest(dir, manifest);
    }
    return send(res, 200, { jobs: created, folder: path.join(baseDir(), folder), project: (currentProject() || {}).name || '' });
  }
  if (pathname === '/images/download') {
    const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    const size = ['small', 'medium', 'large', 'original'].includes(body.size) ? body.size : 'large';
    const allReference = items.length > 0 && items.every((it) => it && images.PROVIDERS[it.provider] && images.PROVIDERS[it.provider].commercial === 'reference only');
    const folder = safeFolder(body.folder) || defaultFolder(allReference ? 'references' : 'photos', body.query);
    const manifest = [];
    const keys = images.loadKeys(KEYS_FILE);
    const created = [];
    const credits = [];
    items.forEach((item, index) => {
      if (!item || typeof item !== 'object' || !item.sizes || !images.PROVIDERS[item.provider]) return;
      const url = validUrl(item.sizes[size] || item.sizes.original);
      if (!url || !/^https:/.test(url)) return;
      const clean = { ...item, title: images.safe(item.title), author: images.safe(item.author), license: images.safe(item.license), pageUrl: validUrl(item.pageUrl) || '', licenseUrl: validUrl(item.licenseUrl) || '' };
      const name = images.fileName(clean, size, index);
      const fallbackUrl = validUrl(item.thumb) && /^https:/.test(item.thumb) && !/^data:/.test(item.thumb) ? item.thumb : '';
      const job = createJob(url, name, { kind: 'file', name, referer: clean.pageUrl, fallbackUrl }, { folder, videoId: `img:${clean.id}`, key: `image|${size}` });
      credits.push(`${name} | ${images.creditsLine(clean)}`);
      manifest.push({ file: name, title: clean.title, author: clean.author, license: clean.license, source: clean.pageUrl, seconds: '', width: clean.width || '', height: clean.height || '', kind: clean.commercial === 'reference only' ? 'reference image' : 'photo' });
      images.notifyDownload(clean, keys);
      created.push(publicJob(job, wantsPaths(req)));
    });
    if (credits.length) {
      const dir = path.join(baseDir(), folder);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'credits.txt'), `${credits.join(os.EOL)}${os.EOL}`);
      appendManifest(dir, manifest);
    }
    return send(res, 200, { jobs: created, folder: path.join(baseDir(), folder), project: (currentProject() || {}).name || '' });
  }
  if (pathname === '/cookies') {
    if (!Array.isArray(body.cookies) || body.cookies.length > 20000) return send(res, 400, { error: 'invalid request' });
    writeBrowserCookies(body.cookies);
    return send(res, 200, { count: cookieState.count, hosts: cookieState.hosts });
  }
  const cm = pathname.match(/^\/app\/commands\/(\d+)\/result$/);
  if (cm) {
    const command = appCommands.get(cm[1]);
    if (command) command.finish(body.error ? Object.assign(new Error(String(body.error).slice(0, 300)), { http: 502 }) : null, body.result);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/browser/open' || pathname === '/browser/read' || pathname === '/browser/download') {
    try {
      if (pathname === '/browser/open') {
        const url = validUrl(body.url);
        if (!url) return send(res, 400, { error: 'invalid url' });
        return send(res, 200, await runInApp('browser.open', { url }, 45000));
      }
      if (pathname === '/browser/read') return send(res, 200, await runInApp('browser.read', { maxChars: Math.min(Number(body.maxChars) || 20000, 100000) }));
      const current = await runInApp('browser.read', { maxChars: 0 });
      const option = validOption(body.option || { kind: 'video', height: 2160 });
      if (!option) return send(res, 400, { error: 'invalid option' });
      // The url as title lets the engine's real title replace it once it knows the video.
      const job = createJob(current.url, current.url, option, { fallbackToFile: option.kind === 'video', folder: body.folder, videoId: '', key: '' });
      return send(res, 200, publicJob(job, wantsPaths(req)));
    } catch (e) {
      return send(res, e.http || 500, { error: e.message });
    }
  }
  if (pathname === '/translate') {
    const file = typeof body.file === 'string' ? path.resolve(body.file) : '';
    const to = TRANSLATE_LANGS.includes(body.to) ? body.to : '';
    if (!file || !to || !file.toLowerCase().endsWith('.srt') || !file.startsWith(path.resolve(OUT)) || !fs.existsSync(file)) return send(res, 400, { error: 'Give an .srt inside the downloads folder and a target language.' });
    try {
      const out = await translate.translateSrt(fs.readFileSync(file, 'utf8'), body.from || 'auto', to);
      const target = file.replace(/\.srt$/i, `.${to}.srt`);
      fs.writeFileSync(target, out);
      return send(res, 200, { file: target });
    } catch (e) {
      return send(res, 502, { error: e.message, code: e.code || 'network' });
    }
  }
  if (pathname === '/jobs/cancel-all') {
    [...jobs.values()].forEach(cancelJob);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/open-folder') {
    reveal(null);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/update') {
    startUpdate();
    return send(res, 200, updateState);
  }

  const hm = pathname.match(/^\/history\/([a-f0-9]{12})\/(reveal|remove)$/);
  if (hm) {
    const at = history.findIndex((h) => h.id === hm[1]);
    if (at < 0) return send(res, 404, { error: 'no such entry' });
    if (hm[2] === 'reveal') reveal(history[at].file);
    if (hm[2] === 'remove') {
      history.splice(at, 1);
      saveHistory();
    }
    return send(res, 200, { ok: true });
  }

  const m = pathname.match(/^\/jobs\/([a-f0-9]{12})\/(cancel|reveal|remove)$/);
  if (m) {
    const job = jobs.get(m[1]);
    if (!job) return send(res, 404, { error: 'no such job' });
    if (m[2] === 'cancel') cancelJob(job);
    if (m[2] === 'reveal') reveal(job.file);
    if (m[2] === 'remove' && !['queued', 'running'].includes(job.status)) jobs.delete(job.id);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!res.headersSent) send(res, e.http || 500, { error: e.message });
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is busy: the helper is probably already running.`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

/* ---------- source health: a daily look at every search site ---------- */

let sourceHealth = { checked: 0, running: false, sources: {} };
try { sourceHealth = { ...sourceHealth, ...JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')), running: false }; } catch { /* first run */ }

// Searches one fixed phrase on each source and records how many results came back. A source that used to answer
// and now gives nothing is marked broken, so a site change shows up before anyone hits it mid-project.
// Google is only checked on demand (all = true): it may ask for a human check and open a window.
async function checkSources(all = false) {
  if (sourceHealth.running) return sourceHealth;
  sourceHealth.running = true;
  const query = 'coffee cup';
  const list = [
    ...Object.keys(images.PROVIDERS).filter((p) => all || p !== 'google').map((id) => ({ id, kind: 'images' })),
    ...Object.keys(videos.PROVIDERS).map((id) => ({ id, kind: 'videos' })),
  ];
  const online = appOnline();
  const run = async ({ id, kind }) => {
    const started = Date.now();
    const previous = sourceHealth.sources[`${kind}:${id}`] || {};
    const needsApp = kind === 'images' ? images.PROVIDERS[id].via === 'browser' : videos.PROVIDERS[id].via === 'browser';
    let entry;
    if (needsApp && !online) entry = { ok: false, count: 0, error: 'app not running', skipped: true };
    else {
      try {
        const opts = { query, providers: [id], page: 1, perPage: 5, appOnline: online, scrape: (provider, q, need) => runInApp('images.scrape', { provider, query: q, need }, 120000), ytSearch: (q, need) => runInfo(`ytsearch${need}:${q}`, ['--flat-playlist']) };
        const r = kind === 'images' ? await images.search(opts) : await videos.search(opts);
        const error = r.errors[id] || '';
        entry = { ok: !error && r.items.length > 0, count: r.items.length, error };
      } catch (e) { entry = { ok: false, count: 0, error: e.message.slice(0, 160) }; }
    }
    entry.ms = Date.now() - started;
    entry.at = Date.now();
    entry.lastOk = entry.ok ? entry.at : (previous.lastOk || 0);
    entry.broken = !entry.ok && !entry.skipped && Boolean(previous.lastOk);
    entry.name = kind === 'images' ? images.PROVIDERS[id].name : videos.PROVIDERS[id].name;
    entry.kind = kind;
    sourceHealth.sources[`${kind}:${id}`] = entry;
  };
  // Four at a time keeps the hidden browser windows manageable.
  // Two at a time: the browser sites answer less reliably when many hidden windows load at once.
  for (let i = 0; i < list.length; i += 2) await Promise.all(list.slice(i, i + 2).map(run));
  sourceHealth.checked = Date.now();
  sourceHealth.running = false;
  sourceHealth.broken = Object.values(sourceHealth.sources).filter((s) => s.broken).map((s) => s.name);
  try { fs.writeFileSync(SOURCES_FILE, JSON.stringify(sourceHealth)); } catch { /* disk */ }
  return sourceHealth;
}
// First check a few minutes after start (once the app is up), then every 24 hours; an hourly look fills in a missed one.
setInterval(() => {
  const due = Date.now() - (sourceHealth.checked || 0) > 24 * 60 * 60 * 1000;
  if (due && appOnline() && !sourceHealth.running) checkSources(false);
}, 60 * 60 * 1000);
setTimeout(() => { if (Date.now() - (sourceHealth.checked || 0) > 24 * 60 * 60 * 1000 && appOnline()) checkSources(false); }, 3 * 60 * 1000);

setTimeout(autoUpdate, 60 * 1000);
setInterval(autoUpdate, 60 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`K Downloader helper ${VERSION}`);
  console.log(`Listening on http://${HOST}:${PORT}`);
  console.log(`Saving to:   ${OUT}`);
  const resumed = restoreQueue();
  if (resumed) console.log(`Resumed ${resumed} unfinished download(s).`);
  console.log(`Install script: http://${HOST}:${PORT}${USERSCRIPT_PATH}`);
  console.log('Keep this running while downloading.');
});
