'use strict';
// Free stock footage search. The sites are read through the app's hidden browser windows (see app/scraper.js),
// so no API keys are needed. Every clip carries its licence, so the team knows it may use it.

// via: 'browser' is scraped by the app; 'ytsearch' goes through yt-dlp's search; 'api' is a public endpoint.
// Reference sources hold other people's videos: for inspiration and internal reference only, never for publishing.
const PROVIDERS = {
  pexelsvideo: { name: 'Pexels Videos', via: 'browser', commercial: 'yes', license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', url: 'https://www.pexels.com/videos/' },
  pixabayvideo: { name: 'Pixabay Videos', via: 'browser', commercial: 'yes', license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', url: 'https://pixabay.com/videos/' },
  youtube: { name: 'YouTube', via: 'ytsearch', commercial: 'reference only', license: 'Reference only (YouTube)', licenseUrl: '', url: 'https://www.youtube.com' },
  dailymotion: { name: 'Dailymotion', via: 'api', commercial: 'reference only', license: 'Reference only (Dailymotion)', licenseUrl: '', url: 'https://www.dailymotion.com' },
};
const REFERENCE = (p) => PROVIDERS[p] && PROVIDERS[p].via !== 'browser';
const TIMEOUT = 20000;

const QUALITIES = { best: 100000, '2160': 2160, '1080': 1080, '720': 720 };

const safe = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const orient = (w, h) => (w && h ? (w > h * 1.1 ? 'landscape' : h > w * 1.1 ? 'portrait' : 'square') : '');

/* One shape for every clip:
   { id, provider, title, author, pageUrl, license, licenseUrl, commercial, width, height, duration, thumb, preview,
     files: [{ url, width, height, fps }], orientation } */
function fromScrape(provider, raw, query) {
  const p = PROVIDERS[provider];
  return raw.filter((r) => r && /^https?:/.test(r.url || '') && Array.isArray(r.files) && r.files.length).map((r) => {
    const files = r.files.filter((f) => f && /^https?:/.test(f.url || '')).map((f) => ({ url: f.url, width: f.w || 0, height: f.h || 0, fps: f.fps || 0 })).sort((a, b) => b.height - a.height);
    const top = files[0];
    const pageUrl = /^https?:/.test(r.page || '') ? r.page : p.url;
    return {
      id: `${provider}:${hash(r.page || r.url)}`, provider, title: safe(r.title) || safe(query), author: safe(r.author) || host(pageUrl),
      pageUrl, license: p.license, licenseUrl: p.licenseUrl, commercial: p.commercial,
      width: r.w || top.width || 0, height: r.h || (top.width ? top.height : 0), duration: Math.round(Number(r.duration) || 0),
      thumb: /^https?:/.test(r.thumb || '') ? r.thumb : '', preview: /^https?:/.test(r.preview || '') ? r.preview : '', files,
    };
  });
}

// Reference clips: a page link, a thumbnail and a length. The download goes through the video engine, not a file url.
function reference(provider, { id, title, author, pageUrl, thumb, duration, width = 0, height = 0 }) {
  const p = PROVIDERS[provider];
  return {
    id: `${provider}:${id}`, provider, title: safe(title) || id, author: safe(author), pageUrl, license: p.license, licenseUrl: '', commercial: p.commercial,
    width, height, duration: Math.round(Number(duration) || 0), thumb: /^https?:/.test(thumb || '') ? thumb : '', preview: '', files: [], reference: true,
  };
}

// YouTube through yt-dlp's search (flat entries: id, title, url, duration, thumbnails).
function fromYouTube(raw) {
  return ((raw && raw.entries) || []).filter((e) => e && e.id && !/^\[(private|deleted)/i.test(e.title || '')).map((e) => {
    const thumbs = Array.isArray(e.thumbnails) ? e.thumbnails : [];
    const thumb = (thumbs.find((t) => t.width >= 600) || thumbs[thumbs.length - 1] || {}).url || `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`;
    return reference('youtube', { id: e.id, title: e.title, author: e.channel || e.uploader || 'YouTube', pageUrl: e.url || `https://www.youtube.com/watch?v=${e.id}`, thumb, duration: e.duration });
  });
}

// Dailymotion's public search endpoint needs no key.
async function dailymotion({ query, page, perPage }) {
  const url = `https://api.dailymotion.com/videos?search=${encodeURIComponent(query)}&limit=${Math.min(perPage, 50)}&page=${page}&fields=id,title,duration,thumbnail_480_url,url,owner.screenname,aspect_ratio`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Dailymotion answered ${res.status}`);
  const data = await res.json();
  return (data.list || []).map((v) => reference('dailymotion', {
    id: v.id, title: v.title, author: v['owner.screenname'], pageUrl: v.url, thumb: v.thumbnail_480_url, duration: v.duration,
    width: v.aspect_ratio ? Math.round(v.aspect_ratio * 1000) : 0, height: v.aspect_ratio ? 1000 : 0,
  }));
}

function available(appOnline = false) {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, commercial: p.commercial, url: p.url, ready: p.via === 'browser' ? Boolean(appOnline) : true }));
}

// Runs the chosen sources together. scrape(provider, query, need) is the app's hidden browser; ytSearch(query, need)
// is the helper's video engine. Without a chosen list, only the free-to-use sources run.
async function search({ query, providers: chosen, page = 1, perPage = 24, orientation = '', minDuration = 0, maxDuration = 0, scrape = null, ytSearch = null, appOnline = false }) {
  const q = safe(query);
  if (!q) throw Object.assign(new Error('empty query'), { http: 400 });
  const use = (Array.isArray(chosen) && chosen.length ? chosen : Object.keys(PROVIDERS).filter((p) => !REFERENCE(p))).filter((p) => PROVIDERS[p]);
  const results = await Promise.allSettled(use.map(async (p) => {
    const via = PROVIDERS[p].via;
    if (via === 'api') return dailymotion({ query: q, page, perPage });
    if (via === 'ytsearch') {
      if (!ytSearch) throw new Error('search not available');
      return fromYouTube(await ytSearch(q, page * perPage)).slice((page - 1) * perPage, page * perPage);
    }
    if (!appOnline || !scrape) throw new Error('needs the K Downloader app running');
    const r = await scrape(p, q, page * perPage);
    return fromScrape(p, (r && r.items) || [], q).slice((page - 1) * perPage, page * perPage);
  }));
  const lists = [];
  const errors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') lists.push(r.value);
    else errors[use[i]] = String(r.reason && r.reason.message || r.reason).slice(0, 160);
  });
  const merged = [];
  for (let i = 0; lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i]) merged.push(l[i]);
  const seen = new Set();
  const items = merged
    .filter((it) => !seen.has(it.id) && seen.add(it.id))
    .map((it) => ({ ...it, orientation: orient(it.width, it.height) }))
    .filter((it) => !orientation || !it.orientation || it.orientation === orientation)
    .filter((it) => (!minDuration || !it.duration || it.duration >= minDuration) && (!maxDuration || !it.duration || it.duration <= maxDuration));
  return { query: q, page, providers: use, items, errors };
}

// The file closest to the wanted quality without going above it; the smallest one when nothing fits.
function pickFile(item, quality = 'best') {
  const limit = QUALITIES[String(quality)] || QUALITIES.best;
  const files = (item.files || []).slice().sort((a, b) => b.height - a.height);
  return files.find((f) => f.height <= limit) || files[files.length - 1] || null;
}

function fileName(item, file, index) {
  const ext = ((file.url.match(/\.(mp4|mov|webm|mkv)(?=[?#]|$)/i) || [])[1] || 'mp4').toLowerCase();
  const base = `${String(index + 1).padStart(2, '0')} ${item.provider.replace(/video$/, '')} ${item.id.split(':').pop()}${file.height ? ` ${file.height}p` : ''}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim();
  return `${base}.${ext}`;
}

function creditsLine(item) {
  return `${item.title || item.id} | ${item.author || 'unknown author'} | ${item.license}${item.licenseUrl ? ` (${item.licenseUrl})` : ''} | ${item.pageUrl}`;
}

module.exports = { PROVIDERS, QUALITIES, REFERENCE, available, search, pickFile, fileName, creditsLine, safe };
