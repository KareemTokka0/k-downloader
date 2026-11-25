'use strict';
// Image search. Two open libraries answer directly (Openverse, Wikimedia Commons); every other site is read
// through the app's hidden browser windows, the way a person would browse it, so no API keys are needed.
// Every result carries its licence note, so the team knows what it may publish and what is reference only.

const TIMEOUT = 20000;
const UA = 'K Downloader/3.6 (private team tool)';

// via: 'api' answers from here; 'browser' is scraped by the app. commercial: what the team may do with the files.
const PROVIDERS = {
  pexels: { name: 'Pexels', via: 'browser', commercial: 'yes', license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', url: 'https://www.pexels.com' },
  pixabay: { name: 'Pixabay', via: 'browser', commercial: 'yes', license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', url: 'https://pixabay.com' },
  unsplash: { name: 'Unsplash', via: 'browser', commercial: 'yes', license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license', url: 'https://unsplash.com' },
  openverse: { name: 'Openverse', via: 'api', commercial: 'per item', url: 'https://openverse.org' },
  wikimedia: { name: 'Wikimedia Commons', via: 'api', commercial: 'per item', url: 'https://commons.wikimedia.org' },
  google: { name: 'Google Images', via: 'browser', commercial: 'reference only', url: 'https://images.google.com' },
  bing: { name: 'Bing Images', via: 'browser', commercial: 'reference only', url: 'https://www.bing.com/images' },
  yandex: { name: 'Yandex Images', via: 'browser', commercial: 'reference only', url: 'https://yandex.com/images' },
  pinterest: { name: 'Pinterest', via: 'browser', commercial: 'reference only', url: 'https://www.pinterest.com' },
};

function loadKeys() { return {}; }

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`${res.status} ${text.slice(0, 160)}`), { status: res.status });
  }
  return res.json();
}

const safe = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
const orient = (w, h) => (w && h ? (w > h * 1.1 ? 'landscape' : h > w * 1.1 ? 'portrait' : 'square') : '');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const bare = (u) => u.split('?')[0].split('#')[0];
// A short stable id from a url, so the same picture keeps its id between searches.
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

/* Each provider returns items in one shape:
   { id, provider, title, author, authorUrl, pageUrl, license, licenseUrl, commercial, width, height,
     thumb, sizes: { small, medium, large, original } } */

const api = {
  async openverse({ query, page, perPage }) {
    const data = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page=${page}&page_size=${Math.min(perPage, 20)}&mature=false`);
    return (data.results || []).map((r) => ({
      id: `openverse:${r.id}`, provider: 'openverse', title: safe(r.title), author: safe(r.creator), authorUrl: r.creator_url || '',
      pageUrl: r.foreign_landing_url || r.url, license: `${String(r.license).toUpperCase()} ${r.license_version || ''}`.trim(), licenseUrl: r.license_url || '',
      commercial: /^(cc0|pdm|by|by-sa)$/i.test(r.license) ? 'yes' : 'no', width: r.width || 0, height: r.height || 0,
      thumb: r.thumbnail || r.url, sizes: { small: r.thumbnail || r.url, medium: r.url, large: r.url, original: r.url },
    }));
  },

  async wikimedia({ query, page, perPage }) {
    const offset = (page - 1) * perPage;
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${query}`)}&gsrnamespace=6&gsrlimit=${perPage}&gsroffset=${offset}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=640&iiextmetadatafilter=LicenseShortName|License|LicenseUrl|Artist|ImageDescription`;
    const data = await getJson(url);
    return Object.values((data.query || {}).pages || {}).filter((p) => p.imageinfo && p.imageinfo[0]).map((p) => {
      const i = p.imageinfo[0];
      const meta = i.extmetadata || {};
      const lic = safe((meta.LicenseShortName || {}).value || (meta.License || {}).value);
      const original = String(i.url).split('?')[0];
      // Commons serves any width on request, which gives real size steps without extra calls.
      let fileName = original.split('/').pop() || ''; try { fileName = decodeURIComponent(fileName); } catch { /* a file name with a literal % stays as is */ }
      const scaled = (w) => (i.width > w ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=${w}` : original);
      return {
        id: `wikimedia:${p.pageid}`, provider: 'wikimedia', title: safe(p.title.replace(/^File:/, '')), author: safe(String((meta.Artist || {}).value || '').replace(/<[^>]+>/g, '')),
        authorUrl: '', pageUrl: i.descriptionurl, license: lic, licenseUrl: (meta.LicenseUrl || {}).value || '',
        commercial: /cc0|public domain|cc by(?!-nc)|cc-by(?!-nc)|pd/i.test(lic) ? 'yes' : 'no', width: i.width || 0, height: i.height || 0,
        thumb: i.thumburl || original, sizes: { small: scaled(800), medium: scaled(1600), large: scaled(2560), original },
      };
    });
  },
};

// How each scraped site serves the same picture in other sizes. Input is the url read off the search page.
const SIZES = {
  pexels(u) { const b = bare(u); const s = (w) => `${b}?auto=compress&cs=tinysrgb&w=${w}`; return { small: s(1080), medium: s(1920), large: s(3840), original: b }; },
  unsplash(u) { const b = bare(u); const s = (w) => `${b}?w=${w}&q=85&fm=jpg&fit=max`; return { small: s(1080), medium: s(1920), large: s(3840), original: `${b}?q=100&fm=jpg` }; },
  pixabay(u) {
    const m = u.match(/^(.*)_(\d+)\.(\w+)$/);
    if (!m) return { small: u, medium: u, large: u, original: u };
    const s = (w) => `${m[1]}_${w}.${m[3]}`;
    // Larger steps need a Pixabay login, so 1280 is the top without one.
    return { small: s(640), medium: s(960), large: s(1280), original: s(1280) };
  },
  pinterest(u) { const s = (k) => u.replace(/\/\d+x\//, `/${k}/`); return { small: s('474x'), medium: s('736x'), large: s('originals'), original: s('originals') }; },
};
const sameEverySize = (u) => ({ small: u, medium: u, large: u, original: u });

// Turns what the app read off a page into the common item shape.
function fromScrape(provider, raw, query) {
  const p = PROVIDERS[provider];
  return raw.filter((r) => r && /^https?:/.test(r.url || '')).map((r) => {
    const sizes = (SIZES[provider] || sameEverySize)(r.url);
    const pageUrl = /^https?:/.test(r.page || '') ? r.page : p.url;
    const title = safe(r.title).replace(/^Free /, '') || safe(query);
    return {
      id: `${provider}:${hash(r.url)}`, provider, title, author: safe(host(pageUrl) || host(r.url)), authorUrl: '',
      pageUrl, license: p.license || (p.commercial === 'reference only' ? 'Unknown (reference only)' : 'See source page'), licenseUrl: p.licenseUrl || '',
      commercial: p.commercial, width: r.w || 0, height: r.h || 0, thumbWidth: r.tw || 0, thumbHeight: r.th || 0,
      thumb: /^https?:/.test(r.thumb || '') ? r.thumb : sizes.small, sizes,
    };
  });
}

function available(keys, appOnline = false) {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id, name: p.name, commercial: p.commercial, url: p.url, via: p.via, needsKey: false,
    ready: p.via === 'api' || Boolean(appOnline),
  }));
}

// Runs the chosen sources together and merges them so no single source dominates the first rows.
// "scrape" is the app's hidden browser: scrape(provider, query, need) -> raw items from the site's page.
async function search({ query, providers: chosen, page = 1, perPage = 24, orientation = '', keys = {}, scrape = null, appOnline = false }) {
  const q = safe(query);
  if (!q) throw Object.assign(new Error('empty query'), { http: 400 });
  const ready = available(keys, appOnline).filter((p) => p.ready).map((p) => p.id);
  const wanted = Array.isArray(chosen) && chosen.length ? chosen : Object.keys(PROVIDERS).filter((p) => PROVIDERS[p].commercial !== 'reference only');
  const use = wanted.filter((p) => PROVIDERS[p]);
  const results = await Promise.allSettled(use.map(async (p) => {
    if (PROVIDERS[p].via === 'api') return api[p]({ query: q, page, perPage });
    if (!ready.includes(p) || !scrape) throw new Error('needs the K Downloader app running');
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
    .filter((it) => it.sizes && it.sizes.original && !seen.has(it.sizes.original) && seen.add(it.sizes.original))
    .map((it) => ({ ...it, orientation: orient(it.width || it.thumbWidth, it.height || it.thumbHeight) }))
    .filter((it) => !orientation || it.orientation === orientation);
  return { query: q, page, providers: use, items, errors };
}

// A safe file name for one image: query, provider and id, with the right extension.
function fileName(item, size, index) {
  const url = item.sizes[size] || item.sizes.original;
  const ext = ((url.match(/\.(jpe?g|png|webp|gif|svg|tiff?)(?=[?#]|$)/i) || [])[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  const base = `${String(index + 1).padStart(2, '0')} ${item.provider} ${item.id.split(':').pop()}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim();
  return `${base}.${ext}`;
}

function notifyDownload() {}

// Writes a credits file beside the images, so attribution travels with them.
function creditsLine(item) {
  return `${item.title || item.id} | ${item.author || 'unknown author'} | ${item.license}${item.licenseUrl ? ` (${item.licenseUrl})` : ''} | ${item.pageUrl}`;
}

module.exports = { PROVIDERS, available, search, fileName, notifyDownload, creditsLine, loadKeys, safe };
