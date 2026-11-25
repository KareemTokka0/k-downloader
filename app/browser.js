'use strict';
// The app's built-in browser: a WebContentsView with its own persistent session, so the team signs in
// once and every download, and Claude, can use those logins. It only navigates, reads and downloads.

const { WebContentsView, session, shell } = require('electron');

const PARTITION = 'persist:kd-browser';
const HOME = 'https://www.youtube.com/';

module.exports = function createBrowser({ win, api, onState, onCapture }) {
  const ses = session.fromPartition(PARTITION);
  const view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  const wc = view.webContents;
  let visible = false;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  let cookieTimer = 0;

  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

  const state = () => ({ url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() });
  const emit = () => onState(state());
  for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) wc.on(ev, emit);

  // Pop-ups open in the same view; the browser stays one page.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) wc.loadURL(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => { if (!/^https?:|^about:blank/.test(url)) e.preventDefault(); });

  // Every file the page tries to save goes through the helper, with the page's cookies.
  ses.on('will-download', (e, item) => {
    e.preventDefault();
    onCapture({ url: item.getURL(), name: item.getFilename(), referer: wc.getURL() });
  });

  // After each page settles, the session's cookies go to the helper so downloads can use the logins.
  async function pushCookies() {
    try {
      const cookies = await ses.cookies.get({});
      await api('POST', '/cookies', { cookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, hostOnly: c.hostOnly, expirationDate: c.expirationDate })) });
    } catch { /* helper offline; the next page tries again */ }
  }
  const scheduleCookies = () => { clearTimeout(cookieTimer); cookieTimer = setTimeout(pushCookies, 1500); };
  wc.on('did-finish-load', scheduleCookies);
  ses.cookies.on('changed', scheduleCookies);

  function layout() {
    view.setBounds(visible ? bounds : { x: 0, y: 0, width: 0, height: 0 });
    view.setVisible(visible);
  }

  // What Claude sees: text and the media links on the page. The page cannot change the shape of this.
  const READ = (maxChars) => `(() => {
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };
    const text = (document.body && document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, ${maxChars});
    const media = [...document.querySelectorAll('video, video source, audio, audio source')].map((m) => abs(m.currentSrc || m.src)).filter((u) => /^https?:/.test(u) && !u.startsWith('blob:'));
    const pageLinks = [...document.querySelectorAll('a[href]')].map((a) => ({ url: abs(a.href), text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 100) }))
      .filter((l) => /^https?:/.test(l.url) && /(youtube\\.com\\/(watch|shorts)|youtu\\.be\\/|facebook\\.com\\/(reel|watch|.*\\/videos\\/)|fb\\.watch|instagram\\.com\\/(reel|p|tv)\\/|tiktok\\.com\\/.*\\/video\\/|vimeo\\.com\\/\\d+|dailymotion\\.com\\/video)/.test(l.url));
    const seen = new Set();
    return { url: location.href, title: document.title, text, media: [...new Set(media)].slice(0, 20), videoLinks: pageLinks.filter((l) => !seen.has(l.url) && seen.add(l.url)).slice(0, 60) };
  })()`;

  async function waitForLoad(timeoutMs) {
    if (!wc.isLoading()) return;
    await new Promise((resolve) => {
      const done = () => { clearTimeout(t); wc.removeListener('did-stop-loading', done); resolve(); };
      const t = setTimeout(done, timeoutMs);
      wc.once('did-stop-loading', done);
    });
  }

  return {
    view,
    show(on) { visible = on; layout(); if (on && !wc.getURL()) wc.loadURL(HOME); },
    setBounds(b) { bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; layout(); },
    state,
    async command(action, arg) {
      if (action === 'navigate') {
        let url = String(arg || '').trim();
        if (!/^https?:\/\//i.test(url)) url = /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url) ? `https://${url}` : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
        wc.loadURL(url);
      } else if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      else if (action === 'reload') wc.reload();
      else if (action === 'stop') wc.stop();
      else if (action === 'external') shell.openExternal(wc.getURL());
      else if (action === 'clear') { await ses.clearStorageData(); await pushCookies(); }
      return state();
    },
    // Requests relayed from the helper (Claude's tools).
    async run(type, params) {
      if (type === 'browser.open') {
        wc.loadURL(params.url);
        await new Promise((r) => setTimeout(r, 300));
        await waitForLoad(40000);
        await new Promise((r) => setTimeout(r, 800));
        return { url: wc.getURL(), title: wc.getTitle() };
      }
      if (type === 'browser.read') {
        if (!wc.getURL()) throw new Error('No page is open in the browser. Call browser_open first.');
        await waitForLoad(20000);
        return wc.executeJavaScript(READ(Number(params.maxChars) || 0), true);
      }
      throw new Error(`Unknown command ${type}`);
    },
  };
};
