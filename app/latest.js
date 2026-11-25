'use strict';
// Writes dist/latest.json after a build, so installed copies know a newer installer is here.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((n) => /^K Downloader Setup \d+\.\d+\.\d+\.exe$/.test(n));
if (!files.length) throw new Error(`no installer in ${dir}`);
const newest = files.sort((a, b) => {
  const va = a.match(/(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
  const vb = b.match(/(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return va[i] - vb[i];
  return 0;
}).pop();
const version = newest.match(/(\d+\.\d+\.\d+)/)[1];
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, newest))).digest('hex');
fs.writeFileSync(path.join(dir, 'latest.json'), `${JSON.stringify({ version, file: newest, sha256, date: new Date().toISOString() }, null, 2)}\n`);
console.log(`latest.json -> ${version}`);
