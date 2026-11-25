// ==UserScript==
// @name         K Downloader
// @namespace    https://github.com/KareemTokka0/k-downloader
// @version      3.0.0
// @description  ⚡ Kareem Downloader Tool: save videos up to 4K 🎬 or audio as MP3 🎧 from YouTube, Facebook, Instagram, TikTok & more 🌍 No ads, no tracking 🔒
// @author       Kareem Waheed
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiByb2xlPSJpbWciIGFyaWEtbGFiZWw9IksgRG93bmxvYWRlciI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIHJ4PSIyMiIgZmlsbD0iIzA3MzgyQiIvPjxnIGZpbGw9IiMzQkYwQTAiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDE2LjM0IDE2LjM0KSBzY2FsZSguNjYpIj48cG9seWdvbiBwb2ludHM9IjgsOCAzMCw4IDMwLDQyIDU4LDggODYsOCAzMCw3MiAzMCw5MiA4LDkyIi8+PHBvbHlnb24gcG9pbnRzPSI1OCw1MCA3OCw1MCA3OCw2NiA5NCw2NiA2OCw5NCA0Miw2NiA1OCw2NiIvPjwvZz48L3N2Zz4=
// @match        *://*/*
// @noframes
// @inject-into  content
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// @updateURL    http://127.0.0.1:17653/kareem-downloader.user.js
// @downloadURL  http://127.0.0.1:17653/kareem-downloader.user.js
// ==/UserScript==

(function () {
  'use strict';

  const API = 'http://127.0.0.1:17653';
  const TOKEN_KEY = 'kd_token';
  const EDIT_KEY = 'kd_edit';
  // The helper fills this in when it serves the script, which is what makes pairing automatic.
  const EMBEDDED_TOKEN = '__KD_TOKEN__';

  // Pages where the floating button appears. Anywhere else, use the script manager's menu.
  const VIDEO_PAGES = [
    [/(^|\.)youtube\.com$/, /^\/(watch|shorts\/|live\/|clip\/|playlist)/],
    [/(^|\.)youtube-nocookie\.com$/, /^\/embed\//],
    [/(^|\.)facebook\.com$/, /(\/videos\/|\/reel\/|\/reels\/|\/watch|\/share\/[rv]\/)/],
    [/(^|\.)fb\.watch$/, /./],
    [/(^|\.)instagram\.com$/, /^\/(([^/]+)\/)?(reel|reels|p|tv)\//],
    [/(^|\.)tiktok\.com$/, /\/video\//],
    [/(^|\.)(x|twitter)\.com$/, /\/status\/\d+/],
    [/(^|\.)vimeo\.com$/, /^\/(\d+|channels\/|groups\/)/],
    [/(^|\.)dailymotion\.com$/, /^\/video\//],
    [/(^|\.)twitch\.tv$/, /(\/videos\/|\/clip\/|^\/[^/]+\/clip)/],
    [/(^|\.)soundcloud\.com$/, /^\/[^/]+\/[^/]+/],
    [/(^|\.)linkedin\.com$/, /^\/(posts|feed\/update)\//],
    [/(^|\.)pinterest\.[a-z.]+$/, /^\/pin\//],
    [/(^|\.)reddit\.com$/, /\/comments\//],
  ];

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

  const PLAYLIST_QUALITIES = [
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
    engine: 'The site changed how it works. Press Update engine, then try again.',
    nosubs: 'No subtitles in this language for this part of the video.',
    ratelimit: 'The site is limiting requests. Wait a while and try again.',
    unknown: 'Something unexpected went wrong.',
  };
  // Plain file links fail for other reasons than videos do.
  const FILE_ERRORS = {
    unavailable: 'The link answered 404: it expired, or the file is only served while logged in to that site.',
    login: 'The site asks for a login before it gives this file.',
    refused: 'The site refused the download (HTTP 403).',
    method: 'The page sends this file through a form, so only the browser can save it. Turn the K switch off and download it again.',
    'html-instead-of-file': 'The site sent a web page instead of the file (an error or login page). Nothing was saved; download it from the page itself.',
  };

  const STYLE = `
    :host { all: initial; color-scheme: dark; }
    * { box-sizing: border-box; font-family: "Segoe UI", Tahoma, Arial, sans-serif; }
    .launcher {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; padding: 0 15px;
      border: 0; border-radius: 18px; cursor: pointer; white-space: nowrap;
      background: #07382b; color: #3bf0a0; font-size: 14px; font-weight: 600;
    }
    .launcher:hover { background: #0b4d3b; }
    .launcher.on-dark { background: #3bf0a0; color: #07382b; }
    .launcher.on-dark:hover { background: #6df5b9; }
    .launcher svg { flex: none; width: 18px; height: 18px; }
    .launcher.round { width: 48px; height: 48px; padding: 0; border-radius: 50%; box-shadow: 0 2px 10px #0006; }
    .launcher.round svg { width: 24px; height: 24px; }
    .launcher.round .label { display: none; }
    .launcher.round.busy svg { display: none; }
    .launcher.round.busy .label { display: inline; font-size: 12px; }
    .launcher.float { height: 42px; border-radius: 21px; padding: 0 17px; box-shadow: 0 6px 20px #0006; }
    .launcher:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid #4ade80; outline-offset: 2px; }
    .panel {
      position: fixed; z-index: 2147483647; direction: ltr;
      display: flex; flex-direction: column; width: 372px; max-width: calc(100vw - 32px);
      overflow: hidden;
      background: #17181b; color: #f2f3f5; font-size: 14px; line-height: 1.5;
      border: 1px solid #33363c; border-radius: 12px; box-shadow: 0 16px 48px #000a;
    }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #2a2c31; }
    .brand { display: flex; align-items: center; gap: 9px; direction: ltr; font-weight: 700; line-height: 1.2; }
    .brand svg { flex: none; width: 28px; height: 28px; }
    .brand small { display: block; color: #a4a8b0; font-size: 11px; font-weight: 400; }
    .icon-btn { width: 32px; height: 32px; border: 0; border-radius: 8px; background: none; color: #b5b8bf; font-size: 18px; cursor: pointer; }
    .icon-btn:hover { background: #2a2c31; color: #fff; }
    .body { overflow-y: auto; padding: 14px; }
    .meta { display: flex; gap: 10px; margin-bottom: 12px; }
    .meta img { width: 96px; height: 54px; object-fit: cover; flex: none; border-radius: 6px; background: #000; }
    .title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-weight: 600; }
    .sub { color: #a4a8b0; font-size: 12px; }
    .section { margin: 12px 0 6px; color: #a4a8b0; font-size: 12px; font-weight: 600; }
    .row {
      display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%;
      min-height: 40px; margin-bottom: 4px; padding: 7px 10px; border: 1px solid #2a2c31; border-radius: 8px;
      background: #1f2125; color: inherit; font-size: 14px; text-align: left; cursor: pointer;
    }
    .row:hover { border-color: #15803d; background: #1d2a22; }
    .row b { font-weight: 600; }
    .tag { display: inline-block; margin-inline-start: 8px; padding: 0 5px; border-radius: 4px; background: #15803d; color: #fff; font-size: 11px; font-weight: 700; }
    .state { padding: 20px 4px; text-align: center; color: #c9ccd2; }
    .spin { width: 22px; height: 22px; margin: 0 auto 10px; border: 3px solid #33363c; border-top-color: #4ade80; border-radius: 50%; animation: s 1s linear infinite; }
    @keyframes s { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 4s; } }
    .btn { min-height: 34px; padding: 5px 12px; border: 1px solid #3a3d44; border-radius: 8px; background: #26282d; color: #f2f3f5; font-size: 13px; cursor: pointer; }
    .btn:hover { background: #30333a; }
    .btn.primary { border-color: #15803d; background: #15803d; color: #fff; font-weight: 600; }
    .btn.primary:hover { background: #166534; }
    .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 12px; }
    input {
      width: 100%; margin-top: 10px; padding: 8px 10px; border: 1px solid #3a3d44; border-radius: 8px;
      background: #0f1012; color: #fff; font: 13px Consolas, monospace; direction: ltr; text-align: left;
    }
    .job { padding: 9px 0; border-top: 1px solid #2a2c31; }
    .job-title { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; font-weight: 600; }
    .bar { height: 5px; margin: 6px 0 4px; overflow: hidden; border-radius: 3px; background: #33363c; }
    .fill { height: 100%; background: #4ade80; transition: width .3s; }
    .job-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #a4a8b0; font-size: 12px; }
    .job-line .err { color: #fca5a5; }
    .link { padding: 2px 4px; border: 0; background: none; color: #86efac; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .link:hover { text-decoration: underline; }
    .foot { display: flex; justify-content: space-between; gap: 8px; padding: 8px 14px; border-top: 1px solid #2a2c31; }
    .tabs { display: flex; gap: 4px; padding: 6px 10px 0; border-bottom: 1px solid #2a2c31; }
    .tab { padding: 6px 12px; border: 0; border-bottom: 2px solid transparent; background: none; color: #a4a8b0; font-size: 13px; font-weight: 600; cursor: pointer; }
    .tab:hover { color: #fff; }
    .tab.on { border-bottom-color: #4ade80; color: #fff; }
    .opts { margin-bottom: 10px; border: 1px solid #2a2c31; border-radius: 8px; background: #1b1d20; }
    .opt { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 4px 10px; font-size: 13px; cursor: pointer; }
    .opt + .opt, .opt-more { border-top: 1px solid #2a2c31; }
    .opt input[type=checkbox], .pitem input { flex: none; width: 15px; height: 15px; margin: 0; accent-color: #16a34a; }
    .opt .sub { margin-inline-start: auto; }
    .opt-more { padding: 8px 10px; }
    .times { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 6px; font-size: 12px; }
    .times input { width: 100%; margin: 0; padding: 5px 8px; text-align: center; }
    .now { padding: 4px 8px; border: 1px solid #3a3d44; border-radius: 6px; background: #26282d; color: #f2f3f5; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .now:hover { background: #30333a; }
    select { width: 100%; padding: 6px 8px; border: 1px solid #3a3d44; border-radius: 8px; background: #0f1012; color: #fff; font-size: 13px; }
    select + select { margin-top: 6px; }
    .error { margin-top: 6px; color: #fca5a5; font-size: 12px; }
    .notice { margin-bottom: 10px; padding: 10px; border: 1px solid #3a6b4c; border-radius: 8px; background: #17261d; font-size: 13px; }
    .notice .actions { justify-content: flex-start; margin-top: 8px; }
    .done-mark { margin-inline-start: 6px; color: #86efac; font-size: 11px; font-weight: 600; }
    .banner { display: block; width: 100%; margin-bottom: 10px; padding: 8px 10px; border: 1px solid #3a3d44; border-radius: 8px; background: #1f2125; color: #86efac; font-size: 13px; text-align: right; cursor: pointer; }
    .banner:hover { background: #26282d; }
    .plist { max-height: 240px; overflow-y: auto; margin: 8px 0; border: 1px solid #2a2c31; border-radius: 8px; }
    .pitem { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer; }
    .pitem + .pitem { border-top: 1px solid #26282d; }
    .pitem span:nth-of-type(1) { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .wide { width: 100%; margin-top: 8px; }
    .hrow { padding: 8px 0; border-top: 1px solid #2a2c31; }
    .search { margin: 0 0 8px; direction: ltr; text-align: left; font-family: inherit; }
    .rs { padding: 2px 0 6px; }
    .rs-track { position: relative; height: 30px; cursor: pointer; touch-action: none; user-select: none; }
    .rs-track::before { content: ""; position: absolute; left: 0; right: 0; top: 11px; height: 8px; border-radius: 4px; background: #33363c; }
    .rs-fill { position: absolute; top: 11px; height: 8px; background: #3bf0a0; }
    .rs-handle {
      position: absolute; top: 3px; width: 14px; height: 24px; margin-left: -7px; border: 2px solid #07382b; border-radius: 5px;
      background: #3bf0a0; box-shadow: 0 1px 4px #0008; cursor: ew-resize; touch-action: none;
    }
    .rs-handle:hover, .rs-handle.drag { background: #6df5b9; }
    .rs-handle:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
    .rs-info { display: flex; justify-content: space-between; color: #a4a8b0; font-size: 12px; }
    .rs-info b { color: #f2f3f5; font-weight: 600; }
    textarea {
      width: 100%; min-height: 120px; margin: 0 0 8px; padding: 8px 10px; border: 1px solid #3a3d44; border-radius: 8px;
      background: #0f1012; color: #fff; font: 12px Consolas, monospace; resize: vertical;
    }
    [hidden] { display: none !important; }
  `;

  /* ---------- helpers ---------- */

  // YouTube enforces Trusted Types, so the UI is built with DOM calls instead of innerHTML.
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key in el) el[key] = value;
      else el.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child !== null && child !== undefined && child !== false) el.append(child);
    }
    return el;
  }

  // The K's leg is a download arrow. With a tile it is the full logo.
  function logoSvg(withTile) {
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      return el;
    };
    const svg = make('svg', { viewBox: withTile ? '0 0 100 100' : '6 6 90 90', 'aria-hidden': 'true' });
    if (withTile) svg.append(make('rect', { width: 100, height: 100, rx: 22, fill: '#07382b' }));
    const g = make('g', { fill: withTile ? '#3bf0a0' : 'currentColor' });
    if (withTile) g.setAttribute('transform', 'translate(16.34 16.34) scale(.66)');
    for (const points of ['8,8 30,8 30,42 58,8 86,8 30,72 30,92 8,92', '58,50 78,50 78,66 94,66 68,94 42,66 58,66']) g.append(make('polygon', { points }));
    svg.append(g);
    return svg;
  }

  function pageIsDark() {
    if (/(^|\.)youtube\.com$/.test(location.hostname)) return document.documentElement.hasAttribute('dark');
    for (const el of [document.body, document.documentElement]) {
      const rgb = el && getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (!rgb || rgb[3] === '0') continue;
      return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.4;
    }
    return false;
  }

  function formatBytes(n) {
    if (!n) return '';
    if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
    return `${Math.max(1, Math.round(n / 1048576))} MB`;
  }

  function formatTime(sec) {
    if (!sec) return '';
    const s = Math.round(sec);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }

  // Uses the long side, so a widescreen film at 3840x1608 still counts as 4K.
  // Accepts 83, 1:23 or 1:02:03. Returns null for anything else.
  function parseTime(text) {
    const value = String(text).trim();
    if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(value)) return null;
    return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  }

  function qualityTag(long) {
    if (long >= 3800) return '4K';
    if (long >= 2500) return '2K';
    if (long >= 1280) return 'HD';
    return '';
  }

  function getToken() {
    const saved = GM_getValue(TOKEN_KEY, '');
    if (saved) return saved;
    return /^[a-f0-9]{32}$/.test(EMBEDDED_TOKEN) ? EMBEDDED_TOKEN : '';
  }

  function api(method, path, body, timeout = 120000) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: API + path,
        anonymous: true,
        timeout,
        headers: { 'Content-Type': 'application/json', 'X-KD-Token': getToken() },
        data: body ? JSON.stringify(body) : undefined,
        onload: (res) => {
          let data = {};
          try { data = JSON.parse(res.responseText); } catch { /* handled by status below */ }
          if (res.status >= 200 && res.status < 300) resolve(data);
          else reject(Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code, data }));
        },
        onerror: () => reject(Object.assign(new Error('offline'), { offline: true })),
        // OrangeMonkey reports a refused connection as a timeout, so both mean the helper isn't reachable.
        ontimeout: () => reject(Object.assign(new Error('offline'), { offline: true })),
        onabort: () => reject(Object.assign(new Error('aborted'), { code: 'network' })),
      });
    });
  }

  /* ---------- ui ---------- */

  const ui = {};
  let currentUrl = location.href;
  let forcedOpen = false;
  let infoRequest = 0;
  let pollTimer = null;
  let lastJobs = [];
  let pageSince = Date.now();
  const opts = { translateTo: '', edit: false, cut: false, start: '', end: '', subLang: '', subMode: 'embed' };

  function isVideoPage() {
    return VIDEO_PAGES.some(([hostRe, pathRe]) => hostRe.test(location.hostname) && pathRe.test(location.pathname));
  }

  function shadowHost(id) {
    const host = h('div', { id });
    const root = host.attachShadow({ mode: 'closed' });
    root.append(h('style', {}, STYLE));
    return { host, root };
  }

  function mount() {
    if (ui.host) return;
    const launcher = shadowHost('kareem-downloader-button');
    ui.pillText = h('span', { class: 'label' }, 'Download');
    ui.pill = h('button', { class: 'launcher', type: 'button', title: 'K Downloader', 'aria-label': 'Download', onclick: togglePanel }, logoSvg(false), ui.pillText);
    launcher.root.append(ui.pill);
    ui.host = launcher.host;

    const panel = shadowHost('kareem-downloader-panel');
    ui.body = h('div', {});
    ui.jobs = h('div', {});
    ui.scroller = h('div', { class: 'body' }, ui.jobs, ui.body);
    ui.foot = h('div', { class: 'foot' },
      h('button', { class: 'link', type: 'button', onclick: () => api('POST', '/open-folder').catch(renderApiError) }, 'Open downloads folder'),
      h('button', { class: 'link', type: 'button', onclick: updateEngine }, 'Update engine'));
    ui.tabDownload = h('button', { class: 'tab on', type: 'button', onclick: renderInfo }, 'Download');
    ui.tabLinks = h('button', { class: 'tab', type: 'button', onclick: renderLinks }, 'Links');
    ui.tabHistory = h('button', { class: 'tab', type: 'button', onclick: renderHistory }, 'History');
    ui.panel = h('div', { class: 'panel', hidden: true, role: 'dialog', 'aria-label': 'K Downloader' },
      h('div', { class: 'head' },
        h('span', { class: 'brand' }, logoSvg(true), h('span', {}, 'K Downloader', h('small', {}, 'Kareem Downloader Tool'))),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: closePanel }, '×')),
      h('div', { class: 'tabs' }, ui.tabDownload, ui.tabLinks, ui.tabHistory),
      ui.scroller,
      ui.foot);
    // Typed keys must stay here, or YouTube treats them as its player shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      ui.panel.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Escape') closePanel();
      });
    }
    panel.root.append(ui.panel);
    ui.panelHost = panel.host;
    (document.body || document.documentElement).append(ui.panelHost);

    document.addEventListener('fullscreenchange', refreshVisibility);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !ui.panel.hidden) closePanel();
    });
    document.addEventListener('click', (e) => {
      if (ui.panel.hidden) return;
      const path = e.composedPath();
      if (!path.includes(ui.host) && !path.includes(ui.panelHost)) closePanel();
    }, true);
    let frame = 0;
    const replace = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        placeLauncher();
      });
    };
    window.addEventListener('scroll', replace, { passive: true, capture: true });
    window.addEventListener('resize', replace);
  }

  function refreshVisibility() {
    if (!ui.host && !isVideoPage() && !forcedOpen) return;
    mount();
    placeLauncher();
  }

  /* ---------- button placement ---------- */

  const LIKE_BUTTONS = '[aria-label="Like"],[aria-label="أعجبني"],[data-e2e="like-icon"]';
  const NATIVE_WAIT = 10000;

  function inView(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }

  function largestVideo() {
    let best = null;
    let bestArea = 200 * 150;
    for (const video of document.querySelectorAll('video')) {
      if (!inView(video)) continue;
      const r = video.getBoundingClientRect();
      if (r.width * r.height > bestArea) {
        best = video;
        bestArea = r.width * r.height;
      }
    }
    return best;
  }

  // On reels the like button sits in a column beside the video; feed posts keep theirs below it.
  function likeBeside(video) {
    let best = null;
    for (const el of document.querySelectorAll(LIKE_BUTTONS)) {
      if (!inView(el)) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const beside = x > video.left + video.width / 2 && x < video.right + 120 && y > video.top && y < video.bottom;
      if (beside && (!best || r.left > best.left)) best = r;
    }
    return best;
  }

  function findPlacement() {
    const isYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
    if (isYouTube && location.pathname === '/watch') {
      const row = document.querySelector('ytd-watch-metadata #top-level-buttons-computed');
      if (row && row.getBoundingClientRect().width > 0) return { inline: true, round: false, target: row, where: 'after' };
    }
    if (isYouTube && location.pathname.startsWith('/shorts/')) {
      const bar = [...document.querySelectorAll('reel-action-bar-view-model')].find(inView);
      if (bar) return { inline: true, round: true, target: bar, where: 'prepend' };
    }
    if (isYouTube && location.pathname === '/playlist') return { round: false, float: true };
    // YouTube's row renders late; waiting avoids the button jumping from the video into the row.
    if (isYouTube && Date.now() - pageSince < NATIVE_WAIT) return null;

    const video = largestVideo()?.getBoundingClientRect();
    if (video) {
      const like = likeBeside(video);
      if (like) return { round: true, left: like.left + like.width / 2 - 24, top: Math.max(8, like.top - 58) };
      return { round: true, left: video.right - 60, top: Math.max(8, video.top + 12) };
    }
    return { round: false, float: true };
  }

  function placeLauncher() {
    if (!ui.host) return;
    const hasActive = lastJobs.some((j) => j.status === 'queued' || j.status === 'running');
    const wanted = (isVideoPage() || forcedOpen || hasActive) && !document.fullscreenElement;
    const spot = wanted ? findPlacement() : null;
    if (!spot) {
      ui.host.style.display = 'none';
      return;
    }
    ui.pill.classList.toggle('round', spot.round);
    ui.pill.classList.toggle('float', Boolean(spot.float));
    ui.pill.classList.toggle('on-dark', spot.round || pageIsDark());
    const style = ui.host.style;
    if (spot.inline) {
      const placed = spot.where === 'after' ? spot.target.nextElementSibling === ui.host : spot.target.firstElementChild === ui.host;
      if (!placed) {
        if (spot.where === 'after') spot.target.after(ui.host);
        else spot.target.prepend(ui.host);
      }
      style.cssText = spot.round
        ? 'display:block;flex:none;margin-bottom:10px'
        : 'display:inline-flex;flex:none;align-self:center;margin-inline-start:8px';
    } else {
      if (ui.host.parentElement !== document.body) (document.body || document.documentElement).append(ui.host);
      style.cssText = spot.float
        ? 'display:block;position:fixed;right:22px;bottom:22px;z-index:2147483646'
        : `display:block;position:fixed;left:${Math.round(spot.left)}px;top:${Math.round(spot.top)}px;z-index:2147483646`;
    }
    if (!ui.panel.hidden) positionPanel();
  }

  function positionPanel() {
    const r = ui.pill.getBoundingClientRect();
    const style = ui.panel.style;
    const width = ui.panel.offsetWidth;
    const pageWidth = document.documentElement.clientWidth;
    const clampX = (x) => Math.min(Math.max(16, x), Math.max(16, pageWidth - width - 16));
    if (ui.pill.classList.contains('round')) {
      style.maxHeight = `${innerHeight - 32}px`;
      style.bottom = 'auto';
      style.left = `${clampX(r.left - width - 12)}px`;
      style.top = `${Math.max(16, Math.min(r.top - 120, innerHeight - ui.panel.offsetHeight - 16))}px`;
      return;
    }
    const below = innerHeight - r.bottom - 24;
    const above = r.top - 24;
    style.left = `${clampX(r.right - width)}px`;
    if (below >= 420 || below >= above) {
      style.top = `${r.bottom + 8}px`;
      style.bottom = 'auto';
      style.maxHeight = `${below}px`;
    } else {
      style.top = 'auto';
      style.bottom = `${innerHeight - r.top + 8}px`;
      style.maxHeight = `${above}px`;
    }
  }

  function togglePanel() {
    if (ui.panel.hidden) openPanel();
    else closePanel();
  }

  function openPanel() {
    mount();
    ui.panel.hidden = false;
    refreshVisibility();
    startPolling();
    renderInfo();
  }

  function closePanel() {
    ui.panel.hidden = true;
    if (!isVideoPage()) forcedOpen = false;
    refreshVisibility();
  }

  function setBody(...nodes) {
    ui.refreshRows = null;
    ui.body.replaceChildren(...nodes.filter(Boolean));
  }

  function renderLoading(text) {
    setBody(h('div', { class: 'state' }, h('div', { class: 'spin' }), text));
  }

  function renderOffline() {
    setBody(h('div', { class: 'state' },
      h('div', {}, 'The K Downloader helper is not running.'),
      h('div', { class: 'sub' }, 'Run start.cmd from the Kareem Downloader folder, then press Try again.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: renderInfo }, 'Try again'))));
  }

  function renderPairing(wrongCode) {
    const input = h('input', { type: 'text', placeholder: 'Pairing code', autocomplete: 'off', spellcheck: false, 'aria-label': 'Pairing code' });
    const save = () => {
      GM_setValue(TOKEN_KEY, input.value.trim());
      renderInfo();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') save();
    });
    setBody(h('div', { class: 'state' },
      h('div', {}, wrongCode ? 'That code is not correct.' : 'Pair the script with the helper. You only do this once.'),
      h('div', { class: 'sub' }, 'Run install.cmd again, or copy the code from %LOCALAPPDATA%\\K Downloader\\pairing-code.txt.'),
      input,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Pair'))));
    input.focus();
  }

  function renderError(code, detail) {
    setBody(h('div', { class: 'state' },
      h('div', {}, ERRORS[code] || ERRORS.unknown),
      detail ? h('div', { class: 'sub', dir: 'ltr' }, detail) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: renderInfo }, 'Try again'))));
  }

  function renderApiError(err) {
    if (err.offline) renderOffline();
    else if (err.status === 401) renderPairing(Boolean(getToken()));
    else renderError(err.code, err.message);
  }

  function setTab(tab) {
    ui.tabDownload.classList.toggle('on', tab === 'download');
    ui.tabLinks.classList.toggle('on', tab === 'links');
    ui.tabHistory.classList.toggle('on', tab === 'history');
    ui.jobs.hidden = tab === 'history';
  }

  function playlistId() {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return '';
    return new URLSearchParams(location.search).get('list') || '';
  }

  async function renderInfo() {
    setTab('download');
    if (!getToken()) return renderPairing(false);
    if (location.pathname === '/playlist' && playlistId()) return renderPlaylist();
    const request = ++infoRequest;
    const url = location.href;
    renderLoading('Getting available qualities...');
    try {
      const info = await api('POST', '/info', { url });
      if (request === infoRequest) renderOptions(info, url);
    } catch (err) {
      if (request === infoRequest) renderApiError(err);
    }
  }

  function optionRow(label, tag, detail, done, onclick) {
    return h('button', { class: 'row', type: 'button', onclick },
      h('span', {}, h('b', {}, label), tag ? h('span', { class: 'tag' }, tag) : null, done ? h('span', { class: 'done-mark' }, '✓ Downloaded') : null),
      h('bdi', { class: 'sub' }, detail || ''));
  }

  function optionKey(o) {
    return [
      o.kind, o.height || o.format || o.lang || o.time || '', o.edit === 'h264' ? 'edit' : o.edit ? `edit-${o.edit}` : '',
      o.subs ? o.subs.mode + (o.subs.source === 'whisper' ? 'ai-' : '') + o.subs.lang : '', o.range ? `${o.range.start}-${o.range.end}` : '',
    ].join('|');
  }

  // Returns the selected range, null when cutting is off, or { error } when the times don't make sense.
  function selectedRange(duration) {
    if (!opts.cut) return null;
    const start = opts.start.trim() ? parseTime(opts.start) : 0;
    const end = opts.end.trim() ? parseTime(opts.end) : duration;
    if (start === null || end === null || !end) return { error: 'Write the time like 1:30 or 90.' };
    if (end <= start) return { error: 'The end must be after the start.' };
    if (duration && start >= duration) return { error: 'The start is after the end of the video.' };
    // The whole video isn't a cut, and cutting would force a slow, needless re-encode.
    if (duration && !start && end >= duration) return null;
    return { start, end: duration ? Math.min(end, duration) : end };
  }

  // Keeps tenths of a second, because editors cut on more than whole seconds.
  function clockText(sec) {
    const whole = Math.floor(sec + 0.001);
    const tenth = Math.floor((sec - whole) * 10 + 0.001);
    return `${formatTime(whole) || '0:00'}${tenth > 0 ? `.${tenth}` : ''}`;
  }

  // The page's video, but only when it is the one in the panel: an ad or another clip has a different length.
  function pageVideo(duration) {
    const video = largestVideo() || document.querySelector('video');
    if (!video) return null;
    return !duration || Math.abs(video.duration - duration) <= 2 ? video : null;
  }

  function currentVideoTime() {
    const video = largestVideo() || document.querySelector('video');
    return video ? clockText(video.currentTime) : '';
  }

  // Two handles over the video's length. Dragging one also moves the video, so you see the frame you're cutting on.
  function rangeSlider(duration, fields, refresh) {
    const MIN_LENGTH = 0.1;
    const fill = h('div', { class: 'rs-fill' });
    const length = h('b', {});
    const seconds = (name) => {
      const typed = opts[name].trim() ? parseTime(opts[name]) : null;
      if (typed === null) return name === 'start' ? 0 : duration;
      return Math.min(typed, duration);
    };
    const percent = (sec) => `${(sec / duration) * 100}%`;
    const handle = (name, label) => h('div', {
      class: 'rs-handle', role: 'slider', tabIndex: 0, 'aria-label': label,
      'aria-valuemin': 0, 'aria-valuemax': Math.round(duration),
      onkeydown: (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const step = (e.shiftKey ? 0.1 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
        move(name, seconds(name) + step);
      },
    });
    const handles = { start: handle('start', 'Cut start'), end: handle('end', 'Cut end') };

    function sync() {
      const start = seconds('start');
      const end = seconds('end');
      handles.start.style.left = percent(start);
      handles.end.style.left = percent(end);
      fill.style.left = percent(start);
      fill.style.width = percent(Math.max(0, end - start));
      for (const [name, sec] of [['start', start], ['end', end]]) {
        handles[name].setAttribute('aria-valuenow', Math.round(sec));
        handles[name].setAttribute('aria-valuetext', clockText(sec));
      }
      length.textContent = clockText(Math.max(0, end - start));
    }

    // Limits seeking while dragging, but always lands on the handle's final position.
    let lastSeek = 0;
    let seekTimer = 0;
    let seekTo = 0;
    function previewFrame(sec) {
      seekTo = sec;
      if (seekTimer) return;
      seekTimer = setTimeout(() => {
        seekTimer = 0;
        lastSeek = Date.now();
        const video = largestVideo() || document.querySelector('video');
        // An ad or another video in the player has a different length and must not be moved.
        if (video && Math.abs(video.duration - duration) <= 2) video.currentTime = seekTo;
      }, Math.max(0, 250 - (Date.now() - lastSeek)));
    }

    function move(name, sec) {
      const low = name === 'start' ? 0 : seconds('start') + MIN_LENGTH;
      const high = name === 'start' ? seconds('end') - MIN_LENGTH : duration;
      const value = Math.round(Math.min(Math.max(sec, low), high) * 10) / 10;
      opts[name] = clockText(value);
      fields[name].value = opts[name];
      sync();
      refresh();
      previewFrame(value);
    }

    const track = h('div', { class: 'rs-track' }, fill, handles.start, handles.end);
    const atPointer = (e) => {
      const box = track.getBoundingClientRect();
      return Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1) * duration;
    };
    let dragging = '';
    track.addEventListener('pointerdown', (e) => {
      const sec = atPointer(e);
      if (e.target === handles.start) dragging = 'start';
      else if (e.target === handles.end) dragging = 'end';
      else dragging = Math.abs(sec - seconds('start')) <= Math.abs(sec - seconds('end')) ? 'start' : 'end';
      handles[dragging].classList.add('drag');
      handles[dragging].focus();
      track.setPointerCapture(e.pointerId);
      e.preventDefault();
      if (e.target === track || e.target === fill) move(dragging, sec);
    });
    track.addEventListener('pointermove', (e) => {
      if (dragging) move(dragging, atPointer(e));
    });
    const stop = () => {
      if (dragging) handles[dragging].classList.remove('drag');
      dragging = '';
    };
    track.addEventListener('pointerup', stop);
    track.addEventListener('pointercancel', stop);

    sync();
    return {
      sync,
      el: h('div', { class: 'rs' }, track, h('div', { class: 'rs-info' }, h('span', {}, 'Selected ', length), h('span', {}, `Total ${clockText(duration)}`))),
    };
  }

  function editPicker(value, onchange) {
    const note = h('span', { class: 'sub' });
    const show = (v) => { note.textContent = (EDIT_FORMATS.find(([key]) => key === v) || EDIT_FORMATS[0])[2]; };
    const select = h('select', { 'aria-label': 'Editing format', style: 'width:auto', onchange: (e) => { show(e.target.value); onchange(e.target.value); } },
      EDIT_FORMATS.map(([key, label]) => h('option', { value: key, selected: key === value }, label)));
    show(value);
    return { select, el: h('div', { class: 'opt' }, h('span', { style: 'white-space:nowrap' }, 'Edit format'), select, note) };
  }

  function optionsBlock(info, refresh, rangeNote) {
    const fields = {};
    let slider = null;
    const changed = () => {
      if (slider) slider.sync();
      refresh();
    };
    const timeField = (name, label, placeholder) => {
      const input = h('input', { type: 'text', value: opts[name], placeholder, 'aria-label': label, autocomplete: 'off', oninput: (e) => { opts[name] = e.target.value; changed(); } });
      fields[name] = input;
      return [h('span', {}, label), input, h('button', { class: 'now', type: 'button', onclick: () => { input.value = currentVideoTime(); opts[name] = input.value; changed(); } }, 'Current time')];
    };
    const times = h('div', { class: 'times' }, timeField('start', 'From', '0:00'), timeField('end', 'To', info.duration ? clockText(info.duration) : '0:00'));
    // A live stream has no known length, so it only gets the time fields.
    if (info.duration) slider = rangeSlider(info.duration, fields, refresh);
    const cutFields = h('div', { class: 'opt-more', hidden: !opts.cut }, slider ? slider.el : null, times, rangeNote);
    const nodes = [
      editPicker(opts.edit, (v) => { opts.edit = v; GM_setValue(EDIT_KEY, v); refresh(); }).el,
      h('label', { class: 'opt' },
        h('input', { type: 'checkbox', checked: opts.cut, onchange: (e) => { opts.cut = e.target.checked; cutFields.hidden = !opts.cut; refresh(); } }),
        h('span', {}, 'Cut a part'), h('span', { class: 'sub' }, 'Video or audio')),
      cutFields,
    ];
    {
      const mode = h('select', { 'aria-label': 'Subtitle mode', hidden: !opts.subLang, onchange: (e) => { opts.subMode = e.target.value; refresh(); } },
        h('option', { value: 'embed', selected: opts.subMode === 'embed' }, 'Inside the file (can be turned off)'),
        h('option', { value: 'burn', selected: opts.subMode === 'burn' }, 'Burned into the picture'));
      const lang = h('select', { 'aria-label': 'Subtitle language', onchange: (e) => { opts.subLang = e.target.value; mode.hidden = !opts.subLang; refresh(); } },
        h('option', { value: '' }, 'No subtitles'),
        info.subtitles.map((s) => h('option', { value: s.lang, selected: s.lang === opts.subLang }, s.auto ? `${s.name} (auto)` : s.name)),
        h('optgroup', { label: 'AI subtitles, made on this PC' },
          [['ar', 'Arabic'], ['en', 'English'], ['auto', 'Detect language']].map(([code, name]) => h('option', { value: `ai:${code}`, selected: opts.subLang === `ai:${code}` }, name))));
      const tr = h('select', { 'aria-label': 'Translate subtitles to', hidden: !opts.subLang, onchange: (e) => { opts.translateTo = e.target.value; refresh(); } },
        h('option', { value: '' }, 'No translation'), h('option', { value: 'en', selected: opts.translateTo === 'en' }, 'Translate to English'), h('option', { value: 'ar', selected: opts.translateTo === 'ar' }, 'Translate to Arabic'));
      lang.addEventListener('change', () => { tr.hidden = !opts.subLang; });
      nodes.push(h('div', { class: 'opt-more' }, lang, mode, tr));
    }
    return h('div', { class: 'opts' }, nodes);
  }

  function renderOptions(info, url) {
    const notice = h('div', { hidden: true });
    const rows = h('div', {});
    const rangeNote = h('div', { class: 'error', hidden: true });
    const done = new Set(info.done || []);

    const start = async (option, force) => {
      notice.hidden = true;
      const key = optionKey(option);
      try {
        await api('POST', '/download', { url, title: info.title, option, videoId: info.id, key, force });
        await pollJobs();
        startPolling();
        // The row may be far down the list, and progress and notices appear at the top.
        ui.scroller.scrollTop = 0;
      } catch (err) {
        if (err.status !== 409) return renderApiError(err);
        ui.scroller.scrollTop = 0;
        const entry = err.data.duplicate;
        notice.hidden = false;
        notice.className = 'notice';
        notice.replaceChildren(
          h('div', {}, `You already downloaded this version: ${entry.label}`),
          h('div', { class: 'actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => api('POST', `/history/${entry.id}/reveal`).catch(renderApiError) }, 'Show file'),
            h('button', { class: 'btn', type: 'button', onclick: () => start(option, true) }, 'Download again'),
            h('button', { class: 'btn', type: 'button', onclick: () => { notice.hidden = true; } }, 'Cancel')));
      }
    };

    function refresh() {
      const range = selectedRange(info.duration);
      const rangeError = range && range.error;
      const validRange = range && !range.error ? range : null;
      const share = validRange && info.duration ? (validRange.end - validRange.start) / info.duration : 1;
      const sizeText = (size) => (size ? (validRange ? `about ${formatBytes(size * share)}` : formatBytes(size)) : '');
      const subs = opts.subLang ? (opts.subLang.startsWith('ai:') ? { lang: opts.subLang.slice(3), mode: opts.subMode, source: 'whisper' } : { lang: opts.subLang, mode: opts.subMode }) : null;
      if (subs && opts.translateTo && opts.translateTo !== subs.lang) subs.translateTo = opts.translateTo;
      const out = [];
      rangeNote.hidden = !rangeError;
      rangeNote.textContent = rangeError || '';
      const addRow = (label, tag, detail, option) => {
        const finalOption = { ...option };
        if (validRange && option.kind !== 'thumbnail') finalOption.range = validRange;
        const key = optionKey(finalOption);
        const isDone = done.has(key) || lastJobs.some((j) => j.status === 'done' && j.videoId === info.id && j.key === key);
        out.push(optionRow(label, tag, detail, isDone, () => {
          if (!rangeError || option.kind === 'thumbnail') start(finalOption, false);
        }));
      };
      if (info.video.length) {
        out.push(h('div', { class: 'section' }, 'Video'));
        for (const v of info.video) {
          const option = { kind: 'video', height: v.height };
          if (opts.edit) option.edit = opts.edit;
          if (subs) option.subs = subs;
          addRow(`${v.height}p${v.fps > 30 ? v.fps : ''}`, qualityTag(v.long), sizeText(v.size), option);
        }
      }
      if (info.audio) {
        out.push(h('div', { class: 'section' }, info.audio.bitrate ? `Audio only · source about ${info.audio.bitrate} kbps` : 'Audio only'));
        for (const a of AUDIO_OPTIONS) addRow(a.title, '', a.note, { kind: 'audio', format: a.format });
      }
      const canGrab = info.video.length && pageVideo(info.duration);
      if (info.hasThumbnail || opts.subLang || canGrab) {
        out.push(h('div', { class: 'section' }, 'Other files'));
        if (canGrab) {
          out.push(optionRow('Frame at current time', '', 'PNG · best quality', false, () => {
            const video = pageVideo(info.duration);
            if (video) start({ kind: 'frame', time: Math.round(video.currentTime * 10) / 10 }, false);
          }));
        }
        if (info.hasThumbnail) addRow('Thumbnail', '', 'Best quality · JPG', { kind: 'thumbnail' });
        if (opts.subLang && opts.subLang.startsWith('ai:')) addRow(`AI subtitles ${opts.subLang.slice(3)}${opts.translateTo ? ` → ${opts.translateTo}` : ''}`, '', opts.translateTo ? 'SRT + translated SRT' : 'SRT · made on this PC', { kind: 'transcribe', lang: opts.subLang.slice(3), ...(opts.translateTo ? { translateTo: opts.translateTo } : {}) });
        else if (opts.subLang) addRow(`Subtitle file ${opts.subLang}${opts.translateTo ? ` → ${opts.translateTo}` : ''}`, '', opts.translateTo ? 'SRT + translated SRT' : 'SRT', { kind: 'subtitle', lang: opts.subLang, ...(opts.translateTo ? { translateTo: opts.translateTo } : {}) });
      }
      if (!info.video.length && !info.audio) out.push(h('div', { class: 'state' }, 'No downloadable qualities found.'));
      rows.replaceChildren(...out);
    }

    setBody(
      h('div', { class: 'meta' },
        info.thumbnail ? h('img', { src: info.thumbnail, alt: '', referrerPolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null,
        h('div', {},
          h('div', { class: 'title', dir: 'auto' }, info.title),
          h('div', { class: 'sub' }, [info.uploader, formatTime(info.duration)].filter(Boolean).join(' · ')))),
      playlistId() ? h('button', { class: 'banner', type: 'button', onclick: renderPlaylist }, 'This video is part of a playlist · Show playlist') : null,
      info.isLive ? h('div', { class: 'sub' }, 'Live stream: the file is saved when the stream ends. Cancelling discards the recording.') : null,
      optionsBlock(info, refresh, rangeNote),
      notice,
      rows);
    ui.refreshRows = refresh;
    refresh();
  }

  /* ---------- playlists and lists of links ---------- */

  // One quality and one editing format for many videos at once.
  function batchSettings() {
    const edit = { value: opts.edit };
    const picker = editPicker(opts.edit, (v) => { edit.value = v; });
    const quality = h('select', { 'aria-label': 'Quality', onchange: (e) => { picker.el.hidden = !e.target.value.startsWith('v:'); } },
      PLAYLIST_QUALITIES.map(([value, label]) => h('option', { value }, label)));
    return { quality, edit, settings: h('div', { class: 'opts', style: 'margin-top:10px' }, h('div', { class: 'opt-more', style: 'border-top:0' }, quality), picker.el) };
  }

  function batchOption(quality, edit) {
    const [type, value] = quality.value.split(':');
    if (type !== 'v') return { kind: 'audio', format: value };
    return { kind: 'video', height: Number(value), ...(edit.value ? { edit: edit.value } : {}) };
  }

  function youtubeId(url) {
    try {
      const u = new URL(url);
      if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1, 12);
      if (/(^|\.)youtube\.com$/.test(u.hostname)) return u.searchParams.get('v') || (u.pathname.match(/^\/(shorts|live)\/([\w-]{11})/) || [])[2] || '';
    } catch { /* not a link */ }
    return '';
  }

  function renderLinks() {
    setTab('links');
    infoRequest++;
    const box = h('textarea', { placeholder: 'Paste links here, one per line', 'aria-label': 'Links', spellcheck: false });
    const status = h('div', { class: 'sub' });
    const go = h('button', { class: 'btn primary wide', type: 'button', onclick: run });
    const { quality, edit, settings } = batchSettings();
    const links = () => [...new Set((box.value.match(/https?:\/\/[^\s"'<>]+/g) || []))];
    const updateGo = () => {
      const count = links().length;
      go.textContent = count ? `Download all (${count})` : 'Download all';
      go.disabled = !count;
    };
    box.addEventListener('input', updateGo);

    async function run() {
      const option = batchOption(quality, edit);
      const key = optionKey(option);
      const list = links();
      go.disabled = true;
      let added = 0;
      let skipped = 0;
      let failed = 0;
      for (const url of list) {
        status.textContent = `Adding ${added + skipped + failed + 1} of ${list.length}...`;
        try {
          await api('POST', '/download', { url, title: url, option, videoId: youtubeId(url), key, fallbackToFile: true });
          added++;
        } catch (err) {
          if (err.offline || err.status === 401) return renderApiError(err);
          if (err.status === 409) skipped++;
          else failed++;
        }
      }
      status.textContent = [`Added ${added}`, skipped ? `Skipped ${skipped} already downloaded` : '', failed ? `${failed} links not accepted` : ''].filter(Boolean).join(' · ');
      updateGo();
      await pollJobs();
      startPolling();
      ui.scroller.scrollTop = 0;
    }

    updateGo();
    setBody(
      h('div', { class: 'sub' }, 'Every link downloads with the same settings. Links from any supported site work.'),
      settings,
      box,
      go,
      status);
    box.focus();
  }

  async function renderPlaylist() {
    setTab('download');
    const request = ++infoRequest;
    renderLoading('Getting playlist videos...');
    let list;
    try {
      list = await api('POST', '/playlist', { url: `https://www.youtube.com/playlist?list=${playlistId()}` });
    } catch (err) {
      if (request === infoRequest) renderApiError(err);
      return;
    }
    if (request !== infoRequest) return;

    const selected = new Set(list.entries.map((e) => e.id));
    const status = h('div', { class: 'sub' });
    const go = h('button', { class: 'btn primary wide', type: 'button', onclick: run });
    const updateGo = () => { go.textContent = `Download selected (${selected.size})`; go.disabled = !selected.size; };
    const boxes = list.entries.map((entry) => {
      const box = h('input', { type: 'checkbox', checked: true, onchange: (e) => { if (e.target.checked) selected.add(entry.id); else selected.delete(entry.id); updateGo(); } });
      return { box, row: h('label', { class: 'pitem' }, box, h('span', { title: entry.title, dir: 'auto' }, entry.title), h('span', { class: 'sub' }, formatTime(entry.duration))) };
    });
    const setAll = (on) => {
      boxes.forEach(({ box }, i) => {
        box.checked = on;
        if (on) selected.add(list.entries[i].id);
        else selected.delete(list.entries[i].id);
      });
      updateGo();
    };
    const { quality, edit, settings } = batchSettings();

    async function run() {
      const option = batchOption(quality, edit);
      const key = optionKey(option);
      const chosen = list.entries.filter((e) => selected.has(e.id));
      go.disabled = true;
      let added = 0;
      let skipped = 0;
      for (const entry of chosen) {
        status.textContent = `Adding ${added + skipped + 1} of ${chosen.length}...`;
        try {
          await api('POST', '/download', { url: entry.url, title: entry.title, option, videoId: entry.id, key, folder: list.title });
          added++;
        } catch (err) {
          if (err.status !== 409) return renderApiError(err);
          skipped++;
        }
      }
      status.textContent = `Added ${added}${skipped ? ` · Skipped ${skipped} already downloaded` : ''}`;
      go.disabled = false;
      await pollJobs();
      startPolling();
    }

    updateGo();
    setBody(
      h('div', { class: 'title', dir: 'auto' }, list.title),
      h('div', { class: 'sub' }, [list.uploader, `${list.entries.length} videos`, list.entries.length >= list.limit ? `First ${list.limit} only` : ''].filter(Boolean).join(' · ')),
      location.pathname === '/watch' ? h('button', { class: 'link', type: 'button', onclick: () => { infoRequest++; renderInfo(); } }, 'Back to current video') : null,
      settings,
      h('div', {},
        h('button', { class: 'link', type: 'button', onclick: () => setAll(true) }, 'Select all'),
        h('button', { class: 'link', type: 'button', onclick: () => setAll(false) }, 'Select none')),
      h('div', { class: 'plist' }, boxes.map((b) => b.row)),
      go,
      status);
  }

  /* ---------- history ---------- */

  async function renderHistory() {
    setTab('history');
    infoRequest++;
    renderLoading('Getting history...');
    let entries;
    try {
      entries = (await api('GET', '/history')).entries;
    } catch (err) {
      return renderApiError(err);
    }
    const list = h('div', {});
    const dateText = (at) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const draw = (query) => {
      const q = query.trim().toLowerCase();
      const shown = entries.filter((e) => !q || e.title.toLowerCase().includes(q)).slice(0, 100);
      if (!shown.length) return list.replaceChildren(h('div', { class: 'state' }, entries.length ? 'No results.' : 'No downloads yet.'));
      list.replaceChildren(...shown.map((e) => h('div', { class: 'hrow' },
        h('div', { class: 'job-title', title: e.title, dir: 'auto' }, e.title),
        h('div', { class: 'job-line' },
          h('span', {}, [e.label, formatBytes(e.size), dateText(e.at), e.exists ? '' : 'File deleted'].filter(Boolean).join(' · ')),
          h('span', {},
            e.exists ? h('button', { class: 'link', type: 'button', onclick: () => api('POST', `/history/${e.id}/reveal`).catch(renderApiError) }, 'Show') : null,
            h('button', { class: 'link', type: 'button', onclick: async () => {
              await api('POST', `/history/${e.id}/remove`).catch(renderApiError);
              entries = entries.filter((x) => x !== e);
              draw(search.value);
            } }, 'Remove from history'))))));
    };
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Search by video name', 'aria-label': 'Search history', oninput: (e) => draw(e.target.value) });
    setBody(search, list);
    draw('');
  }

  async function updateEngine() {
    renderLoading('Updating the engine...');
    try {
      let state = await api('POST', '/update', {});
      while (state.running) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        state = await api('GET', '/update', null, 5000);
      }
      if (!state.ok) return renderError('engine', state.message);
      renderInfo();
    } catch (err) {
      renderApiError(err);
    }
  }

  /* ---------- jobs ---------- */

  function jobStatusText(j) {
    if (j.status === 'queued') return 'Queued';
    if (j.status === 'cancelled') return 'Cancelled';
    if (j.status === 'done') return 'Done';
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

  function jobAction(text, path) {
    return h('button', { class: 'link', type: 'button', onclick: () => api('POST', path).then(pollJobs).catch(renderApiError) }, text);
  }

  function renderJobs() {
    if (!ui.jobs) return;
    const active = lastJobs.filter((j) => j.status === 'queued' || j.status === 'running');
    ui.pill.classList.toggle('busy', active.length > 0);
    ui.pillText.textContent = active.length
      ? `${Math.floor(active[0].percent)}%${active.length > 1 ? ` +${active.length - 1}` : ''}`
      : 'Download';
    if (!lastJobs.length) return ui.jobs.replaceChildren();
    const isActive = (j) => j.status === 'queued' || j.status === 'running';
    // Finished jobs live in the history tab; only the latest stay here so the options remain in reach.
    const ordered = [...active.slice(0, 4), ...lastJobs.filter((j) => !isActive(j)).slice(0, 2)];
    const rows = ordered.map((j) => {
      const running = j.status === 'queued' || j.status === 'running';
      const actions = running
        ? jobAction('Cancel', `/jobs/${j.id}/cancel`)
        : [j.status === 'done' ? jobAction('Show', `/jobs/${j.id}/reveal`) : null, jobAction('Hide', `/jobs/${j.id}/remove`)];
      return h('div', { class: 'job' },
        h('div', { class: 'job-title', title: j.title }, `${j.label} · `, h('bdi', {}, j.title)),
        running ? h('div', { class: 'bar' }, h('div', { class: 'fill', style: `width:${j.percent}%` })) : null,
        h('div', { class: 'job-line' },
          h('span', { class: j.status === 'error' ? 'err' : '', title: j.error || '' }, jobStatusText(j)),
          h('span', {}, actions)));
    });
    const hiddenCount = active.length - Math.min(active.length, 4);
    ui.jobs.replaceChildren(
      h('div', { class: 'section' }, 'Downloads'),
      ...rows,
      hiddenCount > 0 ? h('div', { class: 'sub' }, `and ${hiddenCount} more`) : '',
      active.length > 1 ? jobAction('Cancel all', '/jobs/cancel-all') : '');
  }

  async function pollJobs() {
    const data = await api('GET', '/jobs', null, 5000);
    const countDone = (list) => list.filter((j) => j.status === 'done').length;
    const finishedOne = countDone(data.jobs || []) !== countDone(lastJobs);
    lastJobs = data.jobs || [];
    renderJobs();
    if (finishedOne && ui.refreshRows) ui.refreshRows();
    refreshVisibility();
  }

  function startPolling() {
    if (pollTimer) return;
    const tick = async () => {
      try {
        await pollJobs();
      } catch { /* helper offline; the panel shows that on its own request */ }
      const active = lastJobs.some((j) => j.status === 'queued' || j.status === 'running');
      pollTimer = active || (ui.panel && !ui.panel.hidden) ? setTimeout(tick, 1000) : null;
    };
    pollTimer = setTimeout(tick, 0);
  }

  /* ---------- page tracking ---------- */

  // A timer catches every single-page-app navigation without hooking each site's history calls.
  function watchNavigation() {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    pageSince = Date.now();
    infoRequest++;
    Object.assign(opts, { cut: false, start: '', end: '', subLang: '', subMode: 'embed', translateTo: '' });
    refreshVisibility();
    if (ui.panel && !ui.panel.hidden) renderInfo();
  }

  GM_registerMenuCommand('Download from this page', () => {
    forcedOpen = true;
    openPanel();
  });
  GM_registerMenuCommand('Download a list of links', () => {
    forcedOpen = true;
    openPanel();
    renderLinks();
  });
  GM_registerMenuCommand('Change pairing code', () => {
    forcedOpen = true;
    openPanel();
    infoRequest++;
    renderPairing(false);
  });

  // Older versions saved a yes/no for H.264.
  const savedEdit = GM_getValue(EDIT_KEY, '');
  opts.edit = savedEdit === true ? 'h264' : EDIT_FORMATS.some(([key]) => key === savedEdit) ? savedEdit : '';
  refreshVisibility();
  setInterval(watchNavigation, 1000);
  // Sites re-render their toolbars and swap reels, so the button re-checks its place.
  setInterval(refreshVisibility, 500);
})();
