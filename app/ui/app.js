'use strict';
// The window is the browser panel grown up: same helper, same options, plus settings and a jobs column.

const AUDIO_OPTIONS = [
  { format: 'mp3-320', title: 'MP3 High quality', note: '320 kbps' },
  { format: 'mp3-192', title: 'MP3 Smaller file', note: '192 kbps' },
  { format: 'm4a', title: 'M4A', note: 'Original quality when possible' },
  { format: 'wav', title: 'WAV for editing', note: 'Large file' },
];
const EDIT_FORMATS = [
  ['', 'Original', 'Fastest, no conversion'],
  ['h264', 'H.264 MP4', 'Small, opens everywhere'],
  ['prores', 'ProRes 422 MOV', 'Smoothest timeline, very large'],
  ['dnxhr', 'DNxHR HQ MOV', 'Smooth timeline, very large'],
];
const BATCH_QUALITIES = [
  ['v:2160', 'Video up to 4K'], ['v:1440', 'Video up to 2K'], ['v:1080', 'Video 1080p'], ['v:720', 'Video 720p'], ['v:480', 'Video 480p'],
  ['a:mp3-320', 'Audio MP3 320'], ['a:mp3-192', 'Audio MP3 192'], ['a:m4a', 'Audio M4A'], ['a:wav', 'Audio WAV'],
];
const ERRORS = {
  unsupported: 'This site or link is not supported.',
  drm: "This video is DRM protected and can't be downloaded.",
  login: 'This video needs a login. See the cookies.txt section in the README.',
  refused: 'The site refused the download (HTTP 403).',
  unavailable: 'This video is unavailable or was removed.',
  disk: 'Not enough disk space.',
  network: 'Connection problem. Try again.',
  engine: 'The site changed how it works. Press Update now in Settings, then try again.',
  nosubs: 'No subtitles in this language for this part of the video.',
  ratelimit: 'The site is limiting requests. Wait a while and try again.',
  offline: 'The helper is not running. It restarts by itself; if this stays, restart K Downloader.',
  unknown: 'Something unexpected went wrong.',
};
// Plain file links fail for other reasons than videos do.
const FILE_ERRORS = {
  unavailable: 'The link answered 404: it expired, or the file is only served while logged in to that site.',
  login: 'The site asks for a login before it gives this file.',
  refused: 'The site refused the download (HTTP 403). Open the page in the K Downloader browser and save it from there.',
  method: 'The page sends this file through a form, so only the browser can save it. Turn the K switch off in Chrome and download it again.',
  'html-instead-of-file': 'The site sent a web page instead of the file (an error or login page). Nothing was saved; download it from the page itself.',
};

const $ = (id) => document.getElementById(id);
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}
const formatBytes = (n) => (!n ? '' : n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${Math.max(1, Math.round(n / 1048576))} MB`);
function formatTime(sec) {
  if (!sec) return '';
  const s = Math.round(sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
function clockText(sec) {
  const whole = Math.floor(sec + 0.001);
  const tenth = Math.floor((sec - whole) * 10 + 0.001);
  return `${formatTime(whole) || '0:00'}${tenth > 0 ? `.${tenth}` : ''}`;
}
function parseTime(text) {
  const value = String(text).trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(value)) return null;
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}
const qualityTag = (long) => (long >= 3800 ? '4K' : long >= 2500 ? '2K' : long >= 1280 ? 'HD' : '');
function optionKey(o) {
  return [o.kind, o.height || o.format || o.lang || o.time || '', o.edit === 'h264' ? 'edit' : o.edit ? `edit-${o.edit}` : '', o.subs ? o.subs.mode + (o.subs.source === 'whisper' ? 'ai-' : '') + o.subs.lang : '', o.range ? `${o.range.start}-${o.range.end}` : ''].join('|');
}

async function api(method, route, body) {
  const { status, data } = await kd.api(method, route, body);
  if (status >= 200 && status < 300) return data;
  const err = new Error(data.error || `HTTP ${status}`);
  err.status = status;
  err.code = status === 0 ? 'offline' : data.code;
  err.data = data;
  throw err;
}
const errorText = (err) => `${ERRORS[err.code] || ERRORS.unknown}${err.message && err.code !== 'offline' ? ` (${err.message})` : ''}`;

/* ---------- navigation ---------- */

function go(page) {
  for (const b of document.querySelectorAll('.nav')) b.classList.toggle('on', b.dataset.page === page);
  for (const p of document.querySelectorAll('.page')) p.classList.toggle('on', p.id === `page-${page}`);
  if (page === 'history') renderHistory();
  if (page === 'images') { loadProviders(); $('img-q').focus(); }
  if (page === 'footage') { loadVideoProviders(); $('vid-q').focus(); }
  kd.browserShow(page === 'browser');
  if (page === 'browser') requestAnimationFrame(sendBrowserBounds);
  if (page === 'settings') { renderSettings(); drawGpu(); kd.update('state').then(drawUpdate); }
  if (page === 'setup') renderSetup();
  if (page === 'links') $('links').focus();
}
document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
kd.onNavigate(go);

/* ---------- download page ---------- */

const opts = { translateTo: '', edit: localStorage.getItem('edit') || '', cut: false, start: '', end: '', subLang: '', subMode: 'embed' };
let current = null;

function editPicker(value, onchange) {
  const note = h('span', { class: 'sub' });
  const show = (v) => { note.textContent = (EDIT_FORMATS.find(([key]) => key === v) || EDIT_FORMATS[0])[2]; };
  const select = h('select', { 'aria-label': 'Editing format', onchange: (e) => { show(e.target.value); onchange(e.target.value); } },
    EDIT_FORMATS.map(([key, label]) => h('option', { value: key, selected: key === value }, label)));
  show(value);
  return { select, el: h('div', { class: 'opt' }, h('span', {}, 'Edit format'), select, note) };
}

function selectedRange(duration) {
  if (!opts.cut) return null;
  const start = opts.start.trim() ? parseTime(opts.start) : 0;
  const end = opts.end.trim() ? parseTime(opts.end) : duration;
  if (start === null || end === null || !end) return { error: 'Write the time like 1:30 or 90.' };
  if (end <= start) return { error: 'The end must be after the start.' };
  if (duration && start >= duration) return { error: 'The start is after the end of the video.' };
  if (duration && !start && end >= duration) return null;
  return { start, end: duration ? Math.min(end, duration) : end };
}

function rangeSlider(duration, fields, refresh) {
  const MIN = 0.1;
  const fill = h('div', { class: 'rs-fill' });
  const length = h('b', {});
  const seconds = (name) => {
    const typed = opts[name].trim() ? parseTime(opts[name]) : null;
    if (typed === null) return name === 'start' ? 0 : duration;
    return Math.min(typed, duration);
  };
  const pct = (sec) => `${(sec / duration) * 100}%`;
  const handles = { start: h('div', { class: 'rs-handle', title: 'Cut start' }), end: h('div', { class: 'rs-handle', title: 'Cut end' }) };
  function sync() {
    const s = seconds('start');
    const e = seconds('end');
    handles.start.style.left = pct(s);
    handles.end.style.left = pct(e);
    fill.style.left = pct(s);
    fill.style.width = pct(Math.max(0, e - s));
    length.textContent = clockText(Math.max(0, e - s));
  }
  function move(name, sec) {
    const low = name === 'start' ? 0 : seconds('start') + MIN;
    const high = name === 'start' ? seconds('end') - MIN : duration;
    const value = Math.round(Math.min(Math.max(sec, low), high) * 10) / 10;
    opts[name] = clockText(value);
    fields[name].value = opts[name];
    sync();
    refresh();
  }
  const track = h('div', { class: 'rs-track' }, fill, handles.start, handles.end);
  const at = (e) => { const b = track.getBoundingClientRect(); return Math.min(Math.max((e.clientX - b.left) / b.width, 0), 1) * duration; };
  let dragging = '';
  track.addEventListener('pointerdown', (e) => {
    const sec = at(e);
    dragging = e.target === handles.start ? 'start' : e.target === handles.end ? 'end' : Math.abs(sec - seconds('start')) <= Math.abs(sec - seconds('end')) ? 'start' : 'end';
    handles[dragging].classList.add('drag');
    track.setPointerCapture(e.pointerId);
    if (e.target === track || e.target === fill) move(dragging, sec);
  });
  track.addEventListener('pointermove', (e) => { if (dragging) move(dragging, at(e)); });
  const stop = () => { if (dragging) handles[dragging].classList.remove('drag'); dragging = ''; };
  track.addEventListener('pointerup', stop);
  track.addEventListener('pointercancel', stop);
  sync();
  return { sync, el: h('div', { class: 'rs' }, track, h('div', { class: 'rs-info' }, h('span', {}, 'Selected ', length), h('span', {}, `Total ${clockText(duration)}`))) };
}

function optionsBlock(info, refresh, rangeNote) {
  const fields = {};
  let slider = null;
  const changed = () => { if (slider) slider.sync(); refresh(); };
  const field = (name, label, placeholder) => {
    const input = h('input', { type: 'text', value: opts[name], placeholder, oninput: (e) => { opts[name] = e.target.value; changed(); } });
    fields[name] = input;
    return [h('span', {}, label), input, h('span', {})];
  };
  const times = h('div', { class: 'times' }, field('start', 'From', '0:00'), field('end', 'To', info.duration ? clockText(info.duration) : '0:00'));
  if (info.duration) slider = rangeSlider(info.duration, fields, refresh);
  const cutFields = h('div', { class: 'opt-more', hidden: !opts.cut }, slider ? slider.el : null, times, rangeNote);
  const nodes = [
    editPicker(opts.edit, (v) => { opts.edit = v; localStorage.setItem('edit', v); refresh(); }).el,
    h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: opts.cut, onchange: (e) => { opts.cut = e.target.checked; cutFields.hidden = !opts.cut; refresh(); } }), h('span', {}, 'Cut a part'), h('span', { class: 'sub' }, 'Video or audio')),
    cutFields,
  ];
  {
    const mode = h('select', { hidden: !opts.subLang, onchange: (e) => { opts.subMode = e.target.value; refresh(); } },
      h('option', { value: 'embed', selected: opts.subMode === 'embed' }, 'Inside the file (can be turned off)'),
      h('option', { value: 'burn', selected: opts.subMode === 'burn' }, 'Burned into the picture'));
    const lang = h('select', { onchange: (e) => { opts.subLang = e.target.value; mode.hidden = !opts.subLang; refresh(); } },
      h('option', { value: '' }, 'No subtitles'),
      info.subtitles.map((s) => h('option', { value: s.lang, selected: s.lang === opts.subLang }, s.auto ? `${s.name} (auto)` : s.name)),
      h('optgroup', { label: 'AI subtitles, made on this PC' },
        [['ar', 'Arabic'], ['en', 'English'], ['auto', 'Detect language']].map(([code, name]) => h('option', { value: `ai:${code}`, selected: opts.subLang === `ai:${code}` }, name))));
    const tr = h('select', { hidden: !opts.subLang, onchange: (e) => { opts.translateTo = e.target.value; refresh(); } },
      h('option', { value: '' }, 'No translation'), h('option', { value: 'en', selected: opts.translateTo === 'en' }, 'Translate to English'), h('option', { value: 'ar', selected: opts.translateTo === 'ar' }, 'Translate to Arabic'));
    lang.addEventListener('change', () => { tr.hidden = !opts.subLang; });
    nodes.push(h('div', { class: 'opt-more', style: 'display:flex;gap:8px;flex-wrap:wrap' }, lang, mode, tr));
  }
  return h('div', { class: 'opts' }, nodes);
}

const optionRow = (label, tag, detail, done, onclick) => h('button', { class: 'row', type: 'button', onclick },
  h('span', {}, h('b', {}, label), tag ? h('span', { class: 'tag' }, tag) : null, done ? h('span', { class: 'done-mark' }, '✓ Downloaded') : null),
  h('span', { class: 'sub' }, detail || ''));

async function lookup(url) {
  url = (url || $('url').value).trim();
  if (!url) return;
  $('url').value = url;
  const box = $('info');
  box.replaceChildren(h('div', { class: 'state' }, h('div', { class: 'spin' }), 'Getting available qualities...'));
  try {
    const info = await api('POST', '/info', { url });
    current = { info, url };
    renderOptions(info, url);
  } catch (err) {
    const asFile = async () => {
      try {
        await api('POST', '/download', { url, title: url, option: { kind: 'file' } });
        box.replaceChildren(h('div', { class: 'state' }, 'Downloading it as a file. Watch the column on the right.'));
        pollJobs();
      } catch (e2) { alertBox(errorText(e2)); }
    };
    box.replaceChildren(h('div', { class: 'state' }, errorText(err),
      h('div', { class: 'actions', style: 'justify-content:center' },
        h('button', { class: 'btn primary', onclick: () => lookup(url) }, 'Try again'),
        err.code === 'unsupported' || err.code === 'unknown' ? h('button', { class: 'btn', onclick: asFile }, 'Download as a file instead') : null)));
  }
}

function renderOptions(info, url) {
  Object.assign(opts, { cut: false, start: '', end: '', subLang: '', subMode: 'embed', translateTo: '' });
  const notice = h('div', { hidden: true });
  const rows = h('div', {});
  const rangeNote = h('div', { class: 'error', hidden: true });
  const done = new Set(info.done || []);
  const start = async (option, force) => {
    notice.hidden = true;
    try {
      await api('POST', '/download', { url, title: info.title, option, videoId: info.id, key: optionKey(option), force });
      await pollJobs();
    } catch (err) {
      if (err.status !== 409) return alertBox(errorText(err));
      const entry = err.data.duplicate;
      notice.hidden = false;
      notice.className = 'notice';
      notice.replaceChildren(h('div', {}, `You already downloaded this version: ${entry.label}`),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => api('POST', `/history/${entry.id}/reveal`, {}) }, 'Show file'),
          h('button', { class: 'btn', onclick: () => start(option, true) }, 'Download again'),
          h('button', { class: 'btn', onclick: () => { notice.hidden = true; } }, 'Cancel')));
    }
  };
  function refresh() {
    const range = selectedRange(info.duration);
    const rangeError = range && range.error;
    const valid = range && !range.error ? range : null;
    const share = valid && info.duration ? (valid.end - valid.start) / info.duration : 1;
    const sizeText = (size) => (size ? (valid ? `about ${formatBytes(size * share)}` : formatBytes(size)) : '');
    const subs = opts.subLang ? (opts.subLang.startsWith('ai:') ? { lang: opts.subLang.slice(3), mode: opts.subMode, source: 'whisper' } : { lang: opts.subLang, mode: opts.subMode }) : null;
      if (subs && opts.translateTo && opts.translateTo !== subs.lang) subs.translateTo = opts.translateTo;
    rangeNote.hidden = !rangeError;
    rangeNote.textContent = rangeError || '';
    const out = [];
    let grid = null;
    const section = (name) => { out.push(h('div', { class: 'section' }, name)); grid = h('div', { class: 'grid' }); out.push(grid); };
    const addRow = (label, tag, detail, option) => {
      const final = { ...option };
      if (valid && option.kind !== 'thumbnail') final.range = valid;
      const key = optionKey(final);
      const isDone = done.has(key) || lastJobs.some((j) => j.status === 'done' && j.videoId === info.id && j.key === key);
      grid.append(optionRow(label, tag, detail, isDone, () => { if (!rangeError || option.kind === 'thumbnail') start(final, false); }));
    };
    if (info.video.length) {
      section('Video');
      for (const v of info.video) addRow(`${v.height}p${v.fps > 30 ? v.fps : ''}`, qualityTag(v.long), sizeText(v.size), { kind: 'video', height: v.height, ...(opts.edit ? { edit: opts.edit } : {}), ...(subs ? { subs } : {}) });
    }
    if (info.audio) {
      section(info.audio.bitrate ? `Audio only · source about ${info.audio.bitrate} kbps` : 'Audio only');
      for (const a of AUDIO_OPTIONS) addRow(a.title, '', a.note, { kind: 'audio', format: a.format });
    }
    if (info.hasThumbnail || opts.subLang || info.video.length) {
      section('Other files');
      if (info.video.length && info.duration) {
        const at = opts.cut && valid ? valid.start : null;
        grid.append(optionRow('Frame as PNG', '', at !== null ? `at ${clockText(at)} (cut start)` : 'Turn on Cut a part and set From', false, () => {
          if (at === null) return alertBox('Turn on "Cut a part" and drag the start handle to the frame you want.');
          start({ kind: 'frame', time: Math.round(at * 10) / 10 }, false);
        }));
      }
      if (info.hasThumbnail) addRow('Thumbnail', '', 'Best quality · JPG', { kind: 'thumbnail' });
      if (opts.subLang && opts.subLang.startsWith('ai:')) addRow(`AI subtitles ${opts.subLang.slice(3)}${opts.translateTo ? ` → ${opts.translateTo}` : ''}`, '', opts.translateTo ? 'SRT + translated SRT' : 'SRT · made on this PC', { kind: 'transcribe', lang: opts.subLang.slice(3), ...(opts.translateTo ? { translateTo: opts.translateTo } : {}) });
      else if (opts.subLang) addRow(`Subtitle file ${opts.subLang}${opts.translateTo ? ` → ${opts.translateTo}` : ''}`, '', opts.translateTo ? 'SRT + translated SRT' : 'SRT', { kind: 'subtitle', lang: opts.subLang, ...(opts.translateTo ? { translateTo: opts.translateTo } : {}) });
    }
    if (!info.video.length && !info.audio) out.push(h('div', { class: 'state' }, 'No downloadable qualities found.'));
    rows.replaceChildren(...out);
  }
  $('info').replaceChildren(...[
    h('div', { class: 'meta' },
      info.thumbnail ? h('img', { src: info.thumbnail, alt: '', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null,
      h('div', {}, h('div', { class: 'title', dir: 'auto' }, info.title), h('div', { class: 'sub' }, [info.uploader, formatTime(info.duration), info.site].filter(Boolean).join(' · ')))),
    info.isLive ? h('div', { class: 'sub' }, 'Live stream: the file is saved when the stream ends.') : null,
    optionsBlock(info, refresh, rangeNote), notice, rows].filter(Boolean));
  refreshRows = refresh;
  refresh();
}
let refreshRows = null;

function alertBox(text) {
  const box = h('div', { class: 'notice' }, text, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => box.remove() }, 'OK')));
  $('info').prepend(box);
}

$('lookup').addEventListener('click', () => lookup());
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
$('paste').addEventListener('click', async () => { const text = await kd.readClipboard(); const m = String(text).match(/https?:\/\/\S+/); if (m) lookup(m[0]); });

/* ---------- links page ---------- */

function batchSettings(mount) {
  const edit = { value: opts.edit };
  const picker = editPicker(opts.edit, (v) => { edit.value = v; });
  const quality = h('select', { onchange: (e) => { picker.el.hidden = !e.target.value.startsWith('v:'); } }, BATCH_QUALITIES.map(([value, label]) => h('option', { value }, label)));
  mount.replaceChildren(h('div', { class: 'opt-more', style: 'border-top:0' }, quality), picker.el);
  return () => {
    const [type, value] = quality.value.split(':');
    return type === 'v' ? { kind: 'video', height: Number(value), ...(edit.value ? { edit: edit.value } : {}) } : { kind: 'audio', format: value };
  };
}
const linksOption = batchSettings($('links-settings'));
const linksIn = () => [...new Set($('links').value.match(/https?:\/\/[^\s"'<>]+/g) || [])];
const youtubeId = (url) => { try { const u = new URL(url); if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1, 12); if (/(^|\.)youtube\.com$/.test(u.hostname)) return u.searchParams.get('v') || (u.pathname.match(/^\/(shorts|live)\/([\w-]{11})/) || [])[2] || ''; } catch { /* no */ } return ''; };
$('links').addEventListener('input', () => { const n = linksIn().length; $('links-go').textContent = n ? `Download all (${n})` : 'Download all'; $('links-go').disabled = !n; });
$('links-go').addEventListener('click', async () => {
  const option = linksOption();
  const key = optionKey(option);
  const list = linksIn();
  $('links-go').disabled = true;
  let added = 0, skipped = 0, failed = 0;
  for (const url of list) {
    $('links-status').textContent = `Adding ${added + skipped + failed + 1} of ${list.length}...`;
    try { await api('POST', '/download', { url, title: url, option, videoId: youtubeId(url), key, fallbackToFile: true }); added++; } catch (err) { if (err.status === 409) skipped++; else failed++; }
  }
  $('links-status').textContent = [`Added ${added}`, skipped ? `Skipped ${skipped} already downloaded` : '', failed ? `${failed} links not accepted` : ''].filter(Boolean).join(' · ');
  $('links-go').disabled = false;
  pollJobs();
});

/* ---------- browser ---------- */

function sendBrowserBounds() {
  const r = $('b-view').getBoundingClientRect();
  kd.browserBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
}
new ResizeObserver(() => { if ($('page-browser').classList.contains('on')) sendBrowserBounds(); }).observe($('b-view'));
window.addEventListener('resize', () => { if ($('page-browser').classList.contains('on')) sendBrowserBounds(); });
let browserUrl = '';
kd.onBrowserState((s) => {
  browserUrl = s.url;
  if (document.activeElement !== $('b-url')) $('b-url').value = s.url;
  $('b-back').disabled = !s.canGoBack;
  $('b-fwd').disabled = !s.canGoForward;
  $('b-reload').textContent = s.loading ? '×' : '↻';
});
$('b-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { kd.browser('navigate', $('b-url').value); $('b-url').blur(); } });
$('b-back').addEventListener('click', () => kd.browser('back'));
$('b-fwd').addEventListener('click', () => kd.browser('forward'));
$('b-reload').addEventListener('click', () => kd.browser($('b-reload').textContent === '×' ? 'stop' : 'reload'));
$('b-ext').addEventListener('click', () => kd.browser('external'));
$('b-clear').addEventListener('click', async () => { await kd.browser('clear'); toast('Signed out of every site in the built-in browser.'); kd.browser('reload'); });
$('b-dl').addEventListener('click', () => { if (!browserUrl) return; go('download'); lookup(browserUrl); });
function toast(text) {
  const el = h('div', { class: 'toast' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}
kd.onToast(toast);

/* ---------- images ---------- */

const img = { items: [], selected: new Set(), page: 1, providers: new Set(), ready: [] };
const licClass = (it) => (it.commercial === 'yes' ? 'ok' : it.commercial === 'reference only' ? 'ref' : '');
async function loadProviders() {
  try {
    const { providers } = await api('GET', '/images/providers');
    img.ready = providers;
    if (!img.providers.size) providers.filter((p) => p.ready && p.commercial !== 'reference only').forEach((p) => img.providers.add(p.id));
    $('img-providers').replaceChildren(...providers.map((p) => h('button', {
      class: `chip${img.providers.has(p.id) ? ' on' : ''}${p.ready ? '' : ' off'}${p.commercial === 'reference only' ? ' ref' : ''}`, title: p.commercial === 'reference only' ? 'Reference only: no licence comes with these, never publish them' : `Commercial use: ${p.commercial}`,
      onclick: () => { if (!p.ready) return toast('This source needs the K Downloader app running.'); if (img.providers.has(p.id)) img.providers.delete(p.id); else img.providers.add(p.id); loadProviders(); },
    }, p.name)));
  } catch { /* offline */ }
}
function drawImages(append) {
  const grid = $('img-grid');
  const cards = img.items.slice(append ? grid.children.length : 0).map((it) => {
    const card = h('div', { class: `card${img.selected.has(it.id) ? ' on' : ''}`, onclick: () => { if (img.selected.has(it.id)) img.selected.delete(it.id); else img.selected.add(it.id); card.classList.toggle('on'); updateDl(); } },
      h('img', { src: it.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => { e.target.style.opacity = .2; } }),
      h('span', { class: 'tick' }),
      h('a', { class: 'open', href: it.pageUrl, title: 'Open source page', onclick: (e) => { e.stopPropagation(); e.preventDefault(); kd.openExternal(it.pageUrl); } }, '↗'),
      h('div', { class: 'cap' }, h('b', { title: it.title }, it.title || it.id), `${it.author || ''}${it.width ? ` · ${it.width}×${it.height}` : ''}`, h('br'), h('span', { class: `lic ${licClass(it)}` }, it.license)));
    return card;
  });
  if (append) grid.append(...cards); else grid.replaceChildren(...cards);
  $('img-bar').hidden = !img.items.length;
  $('img-more').hidden = !img.items.length;
  $('img-count').textContent = `${img.items.length} results`;
  updateDl();
}
function updateDl() { $('img-dl').textContent = `Download selected (${img.selected.size})`; $('img-dl').disabled = !img.selected.size; }
async function searchImages(nextPage) {
  const query = $('img-q').value.trim();
  if (!query) return;
  if (!nextPage) { img.items = []; img.selected = new Set(); img.page = 1; $('img-grid').replaceChildren(h('div', { class: 'state' }, h('div', { class: 'spin' }), 'Searching...')); }
  else img.page++;
  $('img-status').textContent = '';
  try {
    const r = await api('POST', '/images/search', { query, providers: [...img.providers], page: img.page, perPage: 24, orientation: $('img-orient').value });
    const known = new Set(img.items.map((i) => i.id));
    img.items.push(...r.items.filter((i) => !known.has(i.id)));
    drawImages(nextPage);
    const errs = Object.entries(r.errors || {}).map(([p, e]) => `${p}: ${e}`).join(' · ');
    $('img-status').textContent = errs || (r.items.length ? '' : 'No more results.');
    if (!img.items.length) $('img-grid').replaceChildren(h('div', { class: 'state' }, 'Nothing found. Try other words or turn on more sources.'));
  } catch (err) { $('img-grid').replaceChildren(h('div', { class: 'state' }, errorText(err))); }
}
$('img-go').addEventListener('click', () => searchImages(false));
$('img-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchImages(false); });
$('img-next').addEventListener('click', () => searchImages(true));
$('img-all').addEventListener('click', () => { img.items.forEach((i) => img.selected.add(i.id)); drawImages(false); });
$('img-none').addEventListener('click', () => { img.selected.clear(); drawImages(false); });
$('img-dl').addEventListener('click', async () => {
  const items = img.items.filter((i) => img.selected.has(i.id));
  $('img-dl').disabled = true;
  try {
    const r = await api('POST', '/images/download', { items, size: $('img-size').value, query: $('img-q').value.trim() });
    $('img-status').textContent = `${r.jobs.length} images queued into ${r.folder}`;
    img.selected.clear();
    drawImages(false);
    pollJobs();
  } catch (err) { $('img-status').textContent = errorText(err); $('img-dl').disabled = false; }
});

/* ---------- footage (free stock video) ---------- */

const vid = { items: [], selected: new Set(), page: 1, providers: new Set() };
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
const topRes = (it) => { const h = Math.max(0, ...(it.files || []).map((f) => f.height || 0)); return h >= 2160 ? '4K' : h ? `${h}p` : ''; };
async function loadVideoProviders() {
  try {
    const { providers } = await api('GET', '/videos/providers');
    if (!vid.providers.size) providers.filter((p) => p.ready && p.commercial !== 'reference only').forEach((p) => vid.providers.add(p.id));
    $('vid-providers').replaceChildren(...providers.map((p) => h('button', {
      class: `chip${vid.providers.has(p.id) ? ' on' : ''}${p.ready ? '' : ' off'}${p.commercial === 'reference only' ? ' ref' : ''}`,
      title: p.commercial === 'reference only' ? 'Reference only: other people\'s videos, for inspiration, never publish them' : p.ready ? 'Free to use, also commercially' : 'Needs the K Downloader app running',
      onclick: () => { if (!p.ready) return toast('This source needs the K Downloader app running.'); if (vid.providers.has(p.id)) vid.providers.delete(p.id); else vid.providers.add(p.id); loadVideoProviders(); },
    }, p.name)));
  } catch { /* offline */ }
}
function drawVideos(append) {
  const grid = $('vid-grid');
  const cards = vid.items.slice(append ? grid.children.length : 0).map((it) => {
    // The poster shows at rest; hovering plays the site's small preview, muted.
    const poster = h('img', { src: it.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onerror: (e) => { e.target.style.opacity = .2; } });
    let player = null;
    const card = h('div', { class: `card${vid.selected.has(it.id) ? ' on' : ''}`,
      onclick: () => { if (vid.selected.has(it.id)) vid.selected.delete(it.id); else vid.selected.add(it.id); card.classList.toggle('on'); updateVidDl(); },
      onmouseenter: () => {
        if (!it.preview || player) return;
        // play() right after creation can be dropped while the clip is still loading, so it is asked again once it can play.
        player = h('video', { src: it.preview, muted: true, loop: true, playsInline: true, preload: 'auto', oncanplay: () => { if (player) player.play().catch(() => {}); } });
        player.muted = true;
        poster.replaceWith(player);
        player.play().catch(() => {});
      },
      onmouseleave: () => { if (!player) return; player.pause(); player.replaceWith(poster); player = null; } },
      poster,
      h('span', { class: 'tick' }),
      h('a', { class: 'open', href: it.pageUrl, title: 'Open source page', onclick: (e) => { e.stopPropagation(); e.preventDefault(); kd.openExternal(it.pageUrl); } }, '↗'),
      ...(it.duration ? [h('span', { class: 'badge l' }, fmtDur(it.duration))] : []),
      ...(topRes(it) ? [h('span', { class: 'badge' }, topRes(it))] : []),
      h('div', { class: 'cap' }, h('b', { title: it.title }, it.title || it.id), `${it.author || ''}${it.width && !it.reference ? ` · ${it.width}×${it.height}` : ''}`, h('br'), h('span', { class: `lic ${it.reference ? 'ref' : 'ok'}` }, it.license)));
    return card;
  });
  if (append) grid.append(...cards); else grid.replaceChildren(...cards);
  $('vid-bar').hidden = !vid.items.length;
  $('vid-more').hidden = !vid.items.length;
  $('vid-count').textContent = `${vid.items.length} clips`;
  updateVidDl();
}
function updateVidDl() { $('vid-dl').textContent = `Download selected (${vid.selected.size})`; $('vid-dl').disabled = !vid.selected.size; }
async function searchVideos(nextPage) {
  const query = $('vid-q').value.trim();
  if (!query) return;
  if (!nextPage) { vid.items = []; vid.selected = new Set(); vid.page = 1; $('vid-grid').replaceChildren(h('div', { class: 'state' }, h('div', { class: 'spin' }), 'Searching...')); }
  else vid.page++;
  $('vid-status').textContent = '';
  const [minDuration, maxDuration] = ($('vid-len').value || '0-0').split('-').map(Number);
  try {
    const r = await api('POST', '/videos/search', { query, providers: [...vid.providers], page: vid.page, perPage: 24, orientation: $('vid-orient').value, minDuration, maxDuration });
    const known = new Set(vid.items.map((i) => i.id));
    vid.items.push(...r.items.filter((i) => !known.has(i.id)));
    drawVideos(nextPage);
    const errs = Object.entries(r.errors || {}).map(([p, e]) => `${p}: ${e}`).join(' · ');
    $('vid-status').textContent = errs || (r.items.length ? '' : 'No more results.');
    if (!vid.items.length) $('vid-grid').replaceChildren(h('div', { class: 'state' }, 'Nothing found. Try other words.'));
  } catch (err) { $('vid-grid').replaceChildren(h('div', { class: 'state' }, errorText(err))); }
}
$('vid-go').addEventListener('click', () => searchVideos(false));
$('vid-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchVideos(false); });
$('vid-next').addEventListener('click', () => searchVideos(true));
$('vid-all').addEventListener('click', () => { vid.items.forEach((i) => vid.selected.add(i.id)); drawVideos(false); });
$('vid-none').addEventListener('click', () => { vid.selected.clear(); drawVideos(false); });
$('vid-dl').addEventListener('click', async () => {
  const items = vid.items.filter((i) => vid.selected.has(i.id));
  $('vid-dl').disabled = true;
  try {
    const r = await api('POST', '/videos/download', { items, quality: $('vid-quality').value, query: $('vid-q').value.trim() });
    $('vid-status').textContent = `${r.jobs.length} clips queued into ${r.folder}`;
    vid.selected.clear();
    drawVideos(false);
    pollJobs();
  } catch (err) { $('vid-status').textContent = errorText(err); $('vid-dl').disabled = false; }
});

/* ---------- first-run setup guide ---------- */

async function renderSetup() {
  const s = await kd.settings();
  $('setup-out-note').textContent = `Downloads go to ${s.out}. A projects folder can be set later in Settings.`;
  $('setup-claude-note').textContent = 'Checking...';
  try {
    const c = await kd.claudeStatus();
    const parts = [];
    if (c.codeInstalled) parts.push(c.codeRegistered ? 'Claude Code: registered. Restart Claude Code once and ask it to download something.' : 'Claude Code found but not registered; press Register again in Settings.');
    if (c.desktopInstalled) parts.push(c.desktopRegistered ? 'Claude desktop app: registered. Restart it once.' : 'Claude desktop app found but not registered.');
    if (!c.codeInstalled && !c.desktopInstalled) parts.push('Claude is not installed on this PC yet. Nothing to do: K Downloader registers itself the moment Claude is installed and the app starts.');
    $('setup-claude-note').textContent = parts.join(' ');
  } catch { $('setup-claude-note').textContent = 'Could not check.'; }
}
$('setup-chrome').addEventListener('click', async () => { const ok = await kd.openExtensionsPage('chrome'); $('setup-ext-note').textContent = ok ? 'Chrome opened on its extensions page; the folder path is in your clipboard.' : 'Chrome was not found on this PC.'; });
$('setup-edge').addEventListener('click', async () => { const ok = await kd.openExtensionsPage('edge'); $('setup-ext-note').textContent = ok ? 'Edge opened on its extensions page; the folder path is in your clipboard.' : 'Edge was not found on this PC.'; });
$('setup-extfolder').addEventListener('click', async () => { const s = await kd.settings(); kd.copy(s.extensionDir); kd.openPath(s.extensionDir); $('setup-ext-note').textContent = 'Folder path copied and the folder opened.'; });
$('setup-out').addEventListener('click', async () => { await kd.chooseFolder('out'); renderSetup(); });
$('setup-done').addEventListener('click', async () => { await kd.setupDone(); go('download'); });
$('open-setup').addEventListener('click', () => go('setup'));
$('credit-mail').addEventListener('click', (e) => { e.preventDefault(); kd.openExternal('https://www.linkedin.com/in/kareemtokka/'); });

/* ---------- history ---------- */

async function renderHistory() {
  const box = $('history');
  let entries;
  try { entries = (await api('GET', '/history')).entries; } catch (err) { return box.replaceChildren(h('div', { class: 'state' }, errorText(err))); }
  const draw = () => {
    const q = $('search').value.trim().toLowerCase();
    const shown = entries.filter((e) => !q || e.title.toLowerCase().includes(q)).slice(0, 200);
    if (!shown.length) return box.replaceChildren(h('div', { class: 'state' }, entries.length ? 'No results.' : 'No downloads yet.'));
    box.replaceChildren(...shown.map((e) => h('div', { class: 'hrow' },
      h('div', { style: 'min-width:0' }, h('div', { class: 'job-title', title: e.file || e.title, dir: 'auto' }, e.title),
        h('div', { class: 'job-line' }, [e.label, formatBytes(e.size), new Date(e.at).toLocaleString('en-GB'), e.exists ? '' : 'File deleted'].filter(Boolean).join(' · '))),
      h('div', { style: 'white-space:nowrap' },
        e.exists ? h('button', { class: 'link', onclick: () => kd.showItem(e.file) }, 'Show') : null,
        h('button', { class: 'link', onclick: async () => { await api('POST', `/history/${e.id}/remove`, {}); entries = entries.filter((x) => x !== e); draw(); } }, 'Remove')))));
  };
  $('search').oninput = draw;
  draw();
}

/* ---------- settings ---------- */

async function renderSettings() {
  const s = await kd.settings();
  $('out').textContent = s.out;
  $('data').textContent = s.data;
  $('cache').textContent = s.cacheDir;
  $('projects').textContent = s.projects || 'Not set';
  renderProjects();
  renderSources();
  $('startup').checked = Boolean(s.startWithWindows);
  $('version').textContent = `v${s.version}`;
  try {
    const u = await api('GET', '/update');
    $('engine-note').textContent = u.checked ? `Last check ${new Date(u.checked).toLocaleString('en-GB')}${u.message ? ` · ${u.message}` : ''}` : 'Updates itself once a day.';
  } catch { /* offline */ }
}
function drawUpdate(st) {
  if (!st) return;
  if (document.activeElement !== $('upd-source')) $('upd-source').value = st.source || '';
  $('upd-auto').checked = Boolean(st.autoInstall);
  $('upd-install').hidden = !st.ready;
  const when = st.lastCheck ? ` · checked ${new Date(st.lastCheck).toLocaleString('en-GB')}` : '';
  $('upd-note').textContent = st.checking ? 'Checking...' : st.error ? `${st.error}${when}` : st.ready ? `Version ${st.available.version} is downloaded and ready. It installs at the next sign-in, or press Install update.` : st.source ? `You have the latest version (${st.current})${when}` : `Version ${st.current}. Set the update source below to get new versions automatically.`;
}
$('upd-check').addEventListener('click', async () => drawUpdate(await kd.update('check')));
$('upd-save').addEventListener('click', async () => drawUpdate(await kd.update('setSource', $('upd-source').value)));
$('upd-auto').addEventListener('change', async (e) => drawUpdate(await kd.update('autoInstall', e.target.checked)));
$('upd-install').addEventListener('click', () => kd.update('install'));
kd.onUpdate(drawUpdate);

async function drawGpu() {
  try {
    const g = await api('GET', '/gpu');
    const installing = lastJobs.some((j) => j.kind === 'gpu-whisper' && ['queued', 'running'].includes(j.status));
    $('gpu-install').hidden = !g.nvidia || g.installed || installing;
    $('gpu-note').textContent = !g.nvidia ? 'No NVIDIA card found. Subtitles are made on the processor.'
      : g.installed ? `Installed. Subtitles use the ${g.nvidia.name} (driver ${g.nvidia.driver}).`
      : installing ? 'Downloading the GPU engine, see the column on the right.'
      : `${g.nvidia.name} found (driver ${g.nvidia.driver}). The GPU build of the speech engine makes subtitles several times faster.${g.nvidia.cuda12 ? '' : ' Update the NVIDIA driver to 551 or newer first.'}`;
  } catch { $('gpu-note').textContent = 'Helper offline.'; }
}
$('gpu-install').addEventListener('click', async () => { await api('POST', '/download', { url: 'https://github.com/ggml-org/whisper.cpp', title: 'GPU speech engine', option: { kind: 'gpu-whisper' } }); pollJobs(); drawGpu(); });

$('open-out').addEventListener('click', () => kd.openPath());
$('change-out').addEventListener('click', async () => { $('out').textContent = await kd.chooseFolder('out'); });
$('change-cache').addEventListener('click', async () => { await kd.chooseFolder('cache'); renderSettings(); });
$('clear-cache').addEventListener('click', async () => { await kd.clearFolder('cache'); renderSettings(); });
$('change-projects').addEventListener('click', async () => { await kd.chooseFolder('projects'); renderSettings(); });
$('clear-projects').addEventListener('click', async () => { await kd.clearFolder('projects'); renderSettings(); });

// The project picker: "Downloads folder" or one of the folders under the projects root.
async function renderProjects() {
  const sel = $('project-current');
  try {
    const p = await api('GET', '/projects');
    const current = p.current ? p.current.name : '';
    sel.replaceChildren(h('option', { value: '' }, 'Downloads folder (no project)'), ...p.projects.map((n) => h('option', { value: n, selected: n === current }, n)));
    sel.disabled = !p.root;
    $('projects-note').textContent = p.root ? (current ? `Active project: ${current}. New downloads go into its folders.` : 'Pick a project to aim downloads at it, or leave Downloads.') : 'Optional. A folder of project folders; pick a project and downloads land inside it (01 Brief, 02 References, 03 Footage, 04 Photos, 05 Exports) instead of Downloads.';
  } catch { sel.replaceChildren(h('option', { value: '' }, 'Helper offline')); sel.disabled = true; }
}
$('project-current').addEventListener('change', async (e) => { try { await api('POST', '/projects/use', { name: e.target.value }); } catch (err) { toast(errorText(err)); } renderProjects(); });

async function renderSources(state) {
  try {
    const sh = state || await api('GET', '/sources/health');
    const list = Object.values(sh.sources || {});
    const when = sh.checked ? new Date(sh.checked).toLocaleString('en-GB') : 'never';
    $('sources-note').textContent = sh.running ? 'Checking every source now, this takes a minute or two...' : `Last check: ${when}.${sh.broken && sh.broken.length ? ` Broken: ${sh.broken.join(', ')}.` : list.length ? ' All sources that could be checked answered.' : ''}`;
    $('sources').replaceChildren(...list.map((s) => h('div', { class: 'src', title: s.error || `${s.count} results in ${s.ms} ms` },
      h('span', { class: `led ${s.ok ? 'ok' : s.skipped ? 'skip' : 'bad'}` }),
      h('div', {}, s.name, h('small', {}, s.ok ? `${s.count} results · ${(s.ms / 1000).toFixed(1)} s` : s.skipped ? 'needs the app' : (s.error || 'no results').slice(0, 40))))));
  } catch { /* offline */ }
}
$('sources-check').addEventListener('click', async () => {
  $('sources-note').textContent = 'Checking every source now, this takes a minute or two...';
  $('sources-check').disabled = true;
  try { renderSources(await api('POST', '/sources/check', { all: true })); } catch (err) { $('sources-note').textContent = errorText(err); }
  $('sources-check').disabled = false;
});
$('open-data').addEventListener('click', async () => kd.openPath((await kd.settings()).data));
$('startup').addEventListener('change', (e) => kd.setStartup(e.target.checked));
$('install-script').addEventListener('click', async () => kd.openExternal((await kd.settings()).scriptUrl));
$('open-extension').addEventListener('click', async () => kd.openPath((await kd.settings()).extensionDir));
$('register-mcp').addEventListener('click', async () => { $('mcp-note').textContent = (await kd.registerMcp()) ? 'Registered. Restart Claude Code once, then ask it to download something.' : 'Claude Code was not found on this PC (no ~/.claude.json).'; });
$('update-engine').addEventListener('click', async () => {
  $('engine-note').textContent = 'Updating...';
  try {
    let state = await api('POST', '/update', {});
    while (state.running) { await new Promise((r) => setTimeout(r, 2000)); state = await api('GET', '/update'); }
    $('engine-note').textContent = state.message || (state.ok ? 'Up to date.' : 'Update failed.');
  } catch (err) { $('engine-note').textContent = errorText(err); }
});
$('show-code').addEventListener('click', async () => { const s = await kd.settings(); const el = $('code'); el.textContent = el.textContent.startsWith('•') ? s.pairingCode : '••••••••'; });
$('copy-code').addEventListener('click', async () => kd.copy((await kd.settings()).pairingCode));

/* ---------- jobs column ---------- */

let lastJobs = [];
function jobStatusText(j) {
  if (j.status === 'queued') return 'Queued';
  if (j.status === 'cancelled') return 'Cancelled';
  if (j.status === 'done') return j.kind === 'gpu-whisper' ? 'Installed' : 'Done';
  if (j.status === 'error') return (j.kind === 'file' && FILE_ERRORS[j.errorCode]) || ERRORS[j.errorCode] || ERRORS.unknown;
  if (j.stage === 'prepare') return 'Preparing...';
  if (j.stage === 'process') return 'Merging and finishing the file...';
  if (j.stage === 'subs') return 'Getting subtitles...';
  if (j.stage === 'update') return 'Updating the engine, then trying again...';
  if (j.stage === 'model') return `Downloading the speech model once ${Math.floor(j.percent)}%`;
  if (j.stage === 'transcribe') return `Listening and writing subtitles ${Math.floor(j.percent)}%`;
    if (j.stage === 'translate') return `Translating subtitles ${Math.floor(j.percent)}%`;
  if (j.stage === 'convert') return `Converting ${Math.floor(j.percent)}%`;
  if (j.stage === 'download' && !j.percent) return 'Downloading...';
  const parts = [`${Math.floor(j.percent)}%`];
  if (j.pass > 1) parts.push(`Part ${j.pass}`);
  if (j.speed) parts.push(`${formatBytes(j.speed)}/s`);
  if (j.eta) parts.push(`${formatTime(j.eta)} left`);
  return parts.join(' · ');
}
const jobAction = (text, route) => h('button', { class: 'link', onclick: () => api('POST', route, {}).then(pollJobs).catch(() => {}) }, text);
function renderJobs() {
  const box = $('jobs');
  if (!lastJobs.length) { box.hidden = true; return; }
  box.hidden = false;
  const active = lastJobs.filter((j) => ['queued', 'running'].includes(j.status));
  box.replaceChildren(...[
    h('div', { class: 'section', style: 'margin-top:0' }, active.length ? `Downloads · ${active.length} active` : 'Downloads'),
    ...lastJobs.slice(0, 40).map((j) => {
      const running = ['queued', 'running'].includes(j.status);
      return h('div', { class: 'job' },
        h('div', { class: 'job-title', title: j.title }, `${j.label} · `, h('bdi', {}, j.title)),
        running ? h('div', { class: 'bar' }, h('div', { class: 'fill', style: `width:${j.percent}%` })) : null,
        h('div', { class: 'job-line', style: 'justify-content:space-between' },
          h('span', { class: j.status === 'error' ? 'err' : '', title: j.error || '' }, jobStatusText(j)),
          h('span', {}, running ? jobAction('Cancel', `/jobs/${j.id}/cancel`)
            : [j.status === 'done' ? h('button', { class: 'link', onclick: () => kd.showItem(j.file) }, 'Show') : null, jobAction('Hide', `/jobs/${j.id}/remove`)])));
    }),
    active.length > 1 ? jobAction('Cancel all', '/jobs/cancel-all') : null].filter(Boolean));
}
async function pollJobs() {
  try {
    const data = await api('GET', '/jobs');
    const doneBefore = lastJobs.filter((j) => j.status === 'done').length;
    lastJobs = data.jobs || [];
    $('helper-state').className = 'dot ok';
    if (lastJobs.filter((j) => j.status === 'done').length !== doneBefore && refreshRows) refreshRows();
  } catch {
    $('helper-state').className = 'dot off';
  }
  renderJobs();
}
setInterval(pollJobs, 1000);
pollJobs();
renderSettings();
