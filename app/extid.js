'use strict';
// Copies installer.nsh into the build folder with the extension's Web Store id defined at the top.
const fs = require('fs');
const [src, dest, id = ''] = process.argv.slice(2);
if (id && !/^[a-p]{32}$/.test(id)) throw new Error(`store-id.txt must hold a 32-letter Chrome Web Store id, got "${id}"`);
fs.writeFileSync(dest, `!define KD_EXT_ID "${id}"\n${fs.readFileSync(src, 'utf8')}`);
console.log(id ? `installer: browser checkboxes on (id ${id})` : 'installer: no store id yet, manual extension step shown');
