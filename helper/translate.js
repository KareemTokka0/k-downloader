'use strict';
// Translates SRT subtitles cue by cue, keeping every timestamp. Uses Google Translate's web endpoint
// (no key) and tells the caller plainly when it is being rate-limited.

const TIMEOUT = 20000;
const CONCURRENCY = 4;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const LANGS = { ar: 'Arabic', en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', tr: 'Turkish', ru: 'Russian' };

async function translateText(text, from, to) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from || 'auto')}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
  if (res.status === 429) throw Object.assign(new Error('Google Translate is limiting requests right now. Try again in a few minutes.'), { code: 'ratelimit' });
  if (!res.ok) throw Object.assign(new Error(`translate failed (${res.status})`), { code: 'network' });
  const data = await res.json();
  return (data[0] || []).map((part) => part[0] || '').join('').trim();
}

function parseSrt(text) {
  return text.replace(/^﻿/, '').split(/\r?\n\r?\n/).map((block) => {
    const lines = block.split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes('-->'));
    return at < 0 ? null : { time: lines[at].trim(), text: lines.slice(at + 1).join('\n').trim() };
  }).filter((c) => c && c.text);
}

const buildSrt = (cues) => `${cues.map((c, i) => `${i + 1}\n${c.time}\n${c.text}`).join('\n\n')}\n`;

// Same lines twice in a row get translated once; a lot of speech repeats itself.
async function translateSrt(text, from, to, onProgress) {
  const cues = parseSrt(text);
  const cache = new Map();
  let done = 0;
  const queue = cues.map((c, i) => ({ c, i }));
  const out = new Array(cues.length);
  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const key = next.c.text;
      if (!cache.has(key)) cache.set(key, translateText(key.replace(/\n/g, ' '), from, to));
      out[next.i] = { time: next.c.time, text: await cache.get(key) || next.c.text };
      done += 1;
      if (onProgress) onProgress(done / cues.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return buildSrt(out);
}

module.exports = { translateSrt, translateText, LANGS };
