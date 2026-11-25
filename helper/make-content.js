'use strict';
// Turns the userscript into the Chrome extension's content script, so the Download button
// works without OrangeMonkey. The GM_* functions become messages to the extension's background.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'kareem-downloader.user.js'), 'utf8');
const body = source.slice(source.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length);

const shim = `'use strict';
// Generated from kareem-downloader.user.js by helper/make-content.js. Edit the userscript, not this file.
(async () => {
  if (window.top !== window) return;
  const store = await chrome.storage.local.get({ token: '', kd_edit: '' });
  const KEYS = { kd_token: 'token' };
  const GM_getValue = (key, fallback) => {
    const value = store[KEYS[key] || key];
    return value === undefined || value === '' ? fallback : value;
  };
  const GM_setValue = (key, value) => {
    store[KEYS[key] || key] = value;
    chrome.storage.local.set({ [KEYS[key] || key]: value });
  };
  const menu = {};
  const GM_registerMenuCommand = (name, fn) => { menu[name] = fn; };
  chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === 'menu' && menu[msg.name]) menu[msg.name](); });
  chrome.storage.onChanged.addListener((changes) => { if (changes.token) store.token = changes.token.newValue || ''; });
  // Cross-origin calls go through the background, which adds the pairing code.
  const GM_xmlhttpRequest = (o) => {
    const timer = o.timeout ? setTimeout(() => { done = true; o.ontimeout && o.ontimeout(); }, o.timeout) : 0;
    let done = false;
    chrome.runtime.sendMessage({ type: 'api', method: o.method, url: o.url, body: o.data }, (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!r || chrome.runtime.lastError) return o.onerror && o.onerror();
      if (r.offline) return o.onerror && o.onerror();
      o.onload && o.onload({ status: r.status, responseText: r.text });
    });
  };
`;

const out = `${shim}${body.trim()}\n})();\n`;
fs.writeFileSync(path.join(ROOT, 'extension', 'content.js'), out);
console.log(`content.js: ${out.length} bytes`);
