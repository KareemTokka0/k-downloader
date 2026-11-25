'use strict';
// Image search through hidden browser windows: the app opens a site's own search page, scrolls it, and
// reads the pictures off the page the way a person would. No API keys. The windows share the built-in
// browser's session, so a site the team signed in to there (Pinterest, Google) answers as that account.
// When a site asks to prove you're human, the window is shown so the person can answer, then hidden again.

const { BrowserWindow } = require('electron');

const PARTITION = 'persist:kd-browser';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const IDLE_MS = 5 * 60 * 1000;
const VERIFY_MS = 150 * 1000;
const MAX_ITEMS = 300;

const enc = (q) => encodeURIComponent(q);
const slug = (q) => q.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

// Where each site's search lives (page n of it, for sites that page instead of scrolling) and how to read the results page. The "extract" functions run inside the page
// and return plain data only: { url, thumb, page, title, w, h, tw, th } per picture.
const SITES = {
  google: { url: (q) => `https://www.google.com/search?udm=2&hl=en&safe=active&q=${enc(q)}`, extract: 'google' },
  bing: { url: (q) => `https://www.bing.com/images/search?q=${enc(q)}&first=1&safeSearch=moderate`, extract: 'bing' },
  yandex: { url: (q) => `https://yandex.com/images/search?text=${enc(q)}`, extract: 'yandex' },
  // Free footage. Pexels keeps each clip's files in the page data; Pixabay lists clips as schema.org VideoObjects.
  pexelsvideo: { url: (q, n) => `https://www.pexels.com/search/videos/${enc(q)}/${n > 1 ? `?page=${n}` : ''}`, extract: 'pexelsvideo' },
  pixabayvideo: { url: (q, n) => `https://pixabay.com/videos/search/${enc(q)}/${n > 1 ? `?pagi=${n}` : ''}`, extract: 'pixabayvideo' },
  pinterest: { url: (q) => `https://www.pinterest.com/search/pins/?q=${enc(q)}`, extract: 'dom', host: 'i\\.pinimg\\.com/\\d+x/', page: '/pin/', pageOptional: true },
  pexels: { url: (q) => `https://www.pexels.com/search/${enc(q)}/`, extract: 'dom', host: 'images\\.pexels\\.com/photos/', page: '/photo/' },
  unsplash: { url: (q) => `https://unsplash.com/s/photos/${slug(q)}`, extract: 'dom', host: '^https://images\\.unsplash\\.com/photo-', page: 'unsplash\\.com/photos/' },
  pixabay: { url: (q, n) => `https://pixabay.com/images/search/${enc(q)}/${n > 1 ? `?pagi=${n}` : ''}`, extract: 'dom', host: 'cdn\\.pixabay\\.com/photo/', page: 'pixabay\\.com/(photos|illustrations|vectors)/' },
};

// Google's results page. Runs inside the page (serialized with toString), so it must stay self-contained.
// Tiles only get a real /imgres? link once Google decides to render it, so the page data is read as well:
// every result's full-size picture sits there as ["url", height, width], right after its thumbnail.
function googleExtract() {
  const out = [];
  const seen = new Set();
  const push = (url, thumb, page, title, w, h) => {
    if (!url || !/^https?:/.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ url, thumb: thumb || '', page: page || '', title: (title || '').trim().slice(0, 200), w: w || 0, h: h || 0 });
  };
  for (const a of document.querySelectorAll('a[href*="/imgres?"]')) {
    let p; try { p = new URL(a.href).searchParams; } catch { continue; }
    const img = a.querySelector('img');
    push(p.get('imgurl'), img ? img.currentSrc || img.src : '', p.get('imgrefurl'), img && img.alt, Number(p.get('w')), Number(p.get('h')));
  }
  const fromLinks = out.length;
  const html = document.documentElement.innerHTML;
  const unescape = (s) => s.split('\\u003d').join('=').split('\\u0026').join('&').split('\\/').join('/').split('\\u003f').join('?');
  const re = /\["(https?:\\?\/\\?\/[^"]{10,600}?)",(\d{2,5}),(\d{2,5})\]/g;
  let lastThumb = '';
  let m;
  while ((m = re.exec(html))) {
    const u = unescape(m[1]);
    if (/gstatic\.com\/images|googleusercontent\.com|google\.com\//.test(u)) { lastThumb = u; continue; }
    if (/\.(svg|gif)(\?|$)/i.test(u)) continue;
    push(u, lastThumb, '', '', Number(m[3]), Number(m[2]));
    lastThumb = '';
  }
  // Titles and source pages for the data-only results, from the tiles in reading order when the counts line up.
  const tiles = [...document.querySelectorAll('div[data-lpage], a[href][aria-label]')].map((t) => ({ page: t.getAttribute('data-lpage') || '', title: t.getAttribute('aria-label') || '' })).filter((t) => t.page);
  out.slice(fromLinks).forEach((it, i) => { const t = tiles[fromLinks + i]; if (t && !it.page) { it.page = t.page; if (!it.title) it.title = t.title; } });
  return out;
}

// Pexels video search: every clip on the page sits in __NEXT_DATA__ with its files (width, height, fps, link).
function pexelsVideoExtract() {
  const out = [];
  const nd = document.getElementById('__NEXT_DATA__');
  if (!nd) return out;
  const pages = {};
  for (const a of document.querySelectorAll('a[href*="/video/"]')) { const m = a.href.match(/pexels\.com\/video\/[^/]*?-(\d+)\/?(?:[?#]|$)/); if (m) pages[m[1]] = a.href; }
  const seen = new Set();
  // The files sit under "video"; the clip's title, duration, size and author are on the object around it.
  const walk = (o, d, parent) => {
    if (!o || typeof o !== 'object' || d > 16) return;
    if (Array.isArray(o.video_files) && o.video_files.length) {
      const p = parent || {};
      const files = o.video_files.filter((f) => f && /^https?:/.test(f.link || '') && /mp4/.test(f.file_type || 'mp4')).map((f) => ({ url: f.link, w: Number(f.width) || 0, h: Number(f.height) || 0, fps: Number(f.fps) || 0 }));
      if (!files.length) return;
      const best = files.slice().sort((a, b) => b.h - a.h)[0];
      const id = String(p.id || o.id || (best.url.match(/video-files\/(\d+)/) || [])[1] || '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      const thumb = (o.thumbnail && (o.thumbnail.medium || o.thumbnail.large || o.thumbnail.small)) || (o.image || '');
      const page = p.slug ? `https://www.pexels.com/video/${p.slug}-${id}/` : (pages[id] || '');
      out.push({ url: best.url, preview: o.preview_src || '', thumb: typeof thumb === 'string' ? thumb : '', page, title: String(p.title || p.description || o.alt || '').slice(0, 200), author: String((p.user && (p.user.name || p.user.username)) || ''), duration: Number(p.duration) || 0, w: Number(p.width) || best.w, h: Number(p.height) || best.h, files });
      return;
    }
    for (const k in o) walk(o[k], d + 1, o);
  };
  try { walk(JSON.parse(nd.textContent), 0, null); } catch { /* page changed */ }
  return out;
}

// Pixabay video search: each clip is a schema.org VideoObject whose contentUrl is the small (_tiny) rendition;
// the same path serves _small, _medium and _large.
function pixabayVideoExtract() {
  const out = [];
  const dur = (iso) => { const m = /T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || ''); return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0; };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    let o; try { o = JSON.parse(s.textContent); } catch { continue; }
    const list = Array.isArray(o) ? o : [o];
    for (const v of list) {
      if (!v || v['@type'] !== 'VideoObject' || !/^https?:.*_tiny\.mp4/.test(v.contentUrl || '')) continue;
      const base = v.contentUrl.replace(/_tiny\.mp4$/, '');
      const files = [{ url: `${base}_tiny.mp4`, w: 0, h: 360, fps: 0 }, { url: `${base}_small.mp4`, w: 0, h: 540, fps: 0 }, { url: `${base}_medium.mp4`, w: 0, h: 1080, fps: 0 }, { url: `${base}_large.mp4`, w: 0, h: 2160, fps: 0 }];
      const page = v.acquireLicensePage ? new URL(v.acquireLicensePage, location.href).href : '';
      out.push({ url: files[3].url, preview: v.contentUrl, thumb: v.thumbnailUrl || '', page, title: String(v.name || v.description || '').slice(0, 200), author: '', duration: dur(v.duration), w: 0, h: 0, files });
    }
  }
  return out;
}

// Everything below runs inside the page. It only reads the DOM and returns data.
const EXTRACTORS = {
  pexelsvideo: `(${pexelsVideoExtract.toString()})()`,
  pixabayvideo: `(${pixabayVideoExtract.toString()})()`,
  google: `(${googleExtract.toString()})()`,
  bing: `(() => {
    const out = [];
    for (const a of document.querySelectorAll('a.iusc[m]')) {
      let m; try { m = JSON.parse(a.getAttribute('m')); } catch { continue; }
      if (!m.murl || !/^https?:/.test(m.murl)) continue;
      const img = a.querySelector('img');
      out.push({ url: m.murl, thumb: m.turl || '', page: m.purl || '', title: (m.t || '').trim(), w: 0, h: 0, tw: img && img.naturalWidth || 0, th: img && img.naturalHeight || 0 });
    }
    return out;
  })()`,
  yandex: `(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href*="img_url="]')) {
      let p; try { p = new URL(a.href).searchParams; } catch { continue; }
      const url = p.get('img_url'); if (!url || !/^https?:/.test(url)) continue;
      const img = a.querySelector('img');
      out.push({ url, thumb: img ? img.currentSrc || img.src : '', page: a.href, title: (img && img.alt || '').trim(), w: 0, h: 0, tw: img && img.naturalWidth || 0, th: img && img.naturalHeight || 0 });
    }
    return out;
  })()`,
  dom: `((hostRe, pageRe, pageOptional) => {
    const host = new RegExp(hostRe); const pageOk = new RegExp(pageRe);
    const out = [];
    for (const img of document.images) {
      let src = img.currentSrc || img.src || '';
      // Prefer the largest candidate of a srcset: the same picture, more pixels.
      if (img.srcset) {
        let best = 0;
        for (const part of img.srcset.split(',')) {
          const [u, d] = part.trim().split(/\\s+/); const n = parseFloat(d) || 0;
          if (u && n >= best && host.test(u)) { best = n; src = u; }
        }
      }
      if (!host.test(src)) continue;
      if (img.naturalWidth && img.naturalWidth < 80) continue;
      const a = img.closest('a[href]');
      const page = a ? a.href : '';
      if (!pageOk.test(page) && !(pageOptional && !page)) continue;
      out.push({ url: src, thumb: img.currentSrc || img.src, page, title: (img.alt || '').trim(), w: 0, h: 0, tw: img.naturalWidth || 0, th: img.naturalHeight || 0 });
    }
    return out;
  })`,
};

const BLOCKED = /unusual traffic|not a robot|security verification|verify you are human|just a moment|checking your browser|access denied|captcha/i;
const SIGNALS = `(() => ({ title: document.title, text: (document.body && document.body.innerText || '').slice(0, 600), empty: !document.body || document.body.innerText.trim().length < 40 }))()`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = function createScraper({ onVerify } = {}) {
  const tabs = new Map(); // provider -> { win, query, items, at }

  function closeIdle() {
    for (const [p, t] of tabs) if (Date.now() - t.at > IDLE_MS) { try { t.win.destroy(); } catch { /* gone */ } tabs.delete(p); }
  }
  setInterval(closeIdle, 60 * 1000).unref();

  function extractCode(site) {
    if (site.extract !== 'dom') return EXTRACTORS[site.extract];
    return `${EXTRACTORS.dom}(${JSON.stringify(site.host)}, ${JSON.stringify(site.page)}, ${Boolean(site.pageOptional)})`;
  }

  async function extract(wc, site) {
    const raw = await wc.executeJavaScript(extractCode(site), true).catch(() => []);
    const seen = new Set();
    return (Array.isArray(raw) ? raw : []).filter((it) => it && typeof it.url === 'string' && !seen.has(it.url) && seen.add(it.url)).slice(0, MAX_ITEMS);
  }

  async function blocked(wc) {
    const s = await wc.executeJavaScript(SIGNALS, true).catch(() => ({}));
    return /\/sorry\/|captcha|challenge|dd_referrer/i.test(wc.getURL()) || BLOCKED.test(`${s.title} ${s.text}`) || Boolean(s.empty);
  }

  async function settled(wc, ms) {
    for (let i = 0; i < ms / 250 && wc.isLoading(); i++) await wait(250);
    await wait(1500);
  }

  function open(provider, query) {
    let t = tabs.get(provider);
    if (t && t.win.isDestroyed()) { tabs.delete(provider); t = null; }
    if (t && t.query === query) { t.at = Date.now(); return t; }
    if (t) { try { t.win.destroy(); } catch { /* gone */ } }
    const win = new BrowserWindow({
      show: false, width: 1280, height: 900, title: `K Downloader: ${SITES[provider] ? provider : 'search'}`,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    win.webContents.setUserAgent(UA);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.setAudioMuted(true);
    win.on('close', (e) => { e.preventDefault(); win.hide(); });
    t = { win, query, items: [], at: Date.now(), loaded: false, pageNo: 1, lastPage: false };
    tabs.set(provider, t);
    return t;
  }

  // Loads the search page (once per query), shows it if the site wants a human, then scrolls until it has
  // "need" pictures or the page stops giving more.
  async function scrape({ provider, query, need = 24 }) {
    const site = SITES[provider];
    if (!site) throw new Error(`Unknown image source ${provider}`);
    const q = String(query || '').trim().slice(0, 200);
    if (!q) throw new Error('empty query');
    const t = open(provider, q);
    const wc = t.win.webContents;
    const merge = (fresh) => {
      const known = new Set(t.items.map((i) => i.url));
      for (const it of fresh) if (!known.has(it.url)) { known.add(it.url); t.items.push(it); }
      t.items = t.items.slice(0, MAX_ITEMS);
    };
    if (!t.loaded) {
      await wc.loadURL(site.url(q, 1)).catch(() => {});
      await settled(wc, 30000);
      t.loaded = true;
      // Some pages draw their pictures a moment after they finish loading.
      for (let i = 0; i < 6 && !t.items.length; i++) { if (i) await wait(1000); t.items = await extract(wc, site); }
      if (!t.items.length && await blocked(wc)) {
        // A human can answer the site's check; the window hides again as soon as results appear.
        t.win.show();
        if (onVerify) onVerify(provider);
        const until = Date.now() + VERIFY_MS;
        while (Date.now() < until && !t.win.isDestroyed()) {
          await wait(1000);
          if (!wc.isLoading()) t.items = await extract(wc, site);
          if (t.items.length) break;
        }
        if (!t.win.isDestroyed()) t.win.hide();
        if (!t.items.length) throw new Error(`${provider} asked for a verification that was not completed. Search again to retry.`);
      }
    }
    let still = 0;
    const want = Math.min(need, MAX_ITEMS);
    for (let i = 0; i < 20 && t.items.length < want && !t.lastPage; i++) {
      const before = t.items.length;
      if (still >= 2) {
        // Scrolling gave nothing more: sites that page instead of scrolling get their next page loaded.
        if (site.url(q, 2) === site.url(q, 1) || t.pageNo >= 8) { t.lastPage = true; break; }
        t.pageNo++;
        await wc.loadURL(site.url(q, t.pageNo)).catch(() => {});
        await settled(wc, 30000);
        merge(await extract(wc, site));
        if (t.items.length === before) { t.lastPage = true; break; }
        still = 0;
        continue;
      }
      await wc.executeJavaScript(`(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        for (const b of document.querySelectorAll('button, a, input[type=button]')) {
          const s = (b.innerText || b.value || '').trim();
          if (/^(show|see|load) more( images| results)?$/i.test(s)) { b.click(); break; }
        }
        return 1;
      })()`, true).catch(() => {});
      await wait(1300);
      merge(await extract(wc, site));
      still = t.items.length > before ? 0 : still + 1;
    }
    t.at = Date.now();
    return { provider, query: q, items: t.items.slice(0, want), total: t.items.length, more: t.items.length > want || !t.lastPage };
  }

  return {
    providers: Object.keys(SITES),
    scrape,
    async run(type, params) {
      if (type === 'images.scrape') return scrape(params || {});
      throw new Error(`Unknown command ${type}`);
    },
    destroy() { for (const t of tabs.values()) { try { t.win.destroy(); } catch { /* gone */ } } tabs.clear(); },
  };
};
