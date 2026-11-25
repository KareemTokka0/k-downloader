'use strict';
// Keeps the team on the latest installer without a server: the update source is a shared folder
// (a synced Drive folder works) or an https URL holding latest.json and the Setup file it names.

const { app } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CHECK_EVERY = 6 * 60 * 60 * 1000;

const newer = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

const sha256 = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
});

module.exports = function createUpdater({ getSource, dataDir, onChange }) {
  const dir = path.join(dataDir, 'updates');
  const state = { checking: false, lastCheck: 0, available: null, ready: '', error: '', source: '' };
  const emit = () => onChange({ ...state, current: app.getVersion() });

  async function readLatest(source) {
    if (/^https?:\/\//i.test(source)) {
      const res = await fetch(`${source.replace(/\/$/, '')}/latest.json`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
      if (!res.ok) throw new Error(`latest.json: HTTP ${res.status}`);
      return res.json();
    }
    return JSON.parse(fs.readFileSync(path.join(source, 'latest.json'), 'utf8'));
  }

  async function fetchSetup(source, name, target) {
    if (/^https?:\/\//i.test(source)) {
      const res = await fetch(`${source.replace(/\/$/, '')}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(20 * 60 * 1000) });
      if (!res.ok || !res.body) throw new Error(`download: HTTP ${res.status}`);
      await fs.promises.writeFile(target, res.body);
    } else {
      await fs.promises.copyFile(path.join(source, name), target);
    }
  }

  async function check() {
    const source = String(getSource() || '').trim();
    state.source = source;
    if (!source || state.checking) return emit();
    state.checking = true;
    state.error = '';
    emit();
    try {
      const latest = await readLatest(source);
      if (!latest || !/^\d+\.\d+\.\d+$/.test(latest.version) || !/^[\w .()-]+\.exe$/i.test(latest.file || '') || !/^[a-f0-9]{64}$/i.test(latest.sha256 || '')) throw new Error('latest.json is not valid');
      state.lastCheck = Date.now();
      if (!newer(latest.version, app.getVersion())) {
        state.available = null;
        state.ready = '';
      } else {
        state.available = { version: latest.version, file: latest.file, sha256: latest.sha256.toLowerCase() };
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, latest.file);
        // The checksum protects against a half-copied file in a synced folder, not only against tampering.
        if (!(fs.existsSync(target) && (await sha256(target)) === state.available.sha256)) {
          await fetchSetup(source, latest.file, `${target}.part`);
          if ((await sha256(`${target}.part`)) !== state.available.sha256) {
            fs.rmSync(`${target}.part`, { force: true });
            throw new Error('The downloaded installer does not match its checksum. Will try again later.');
          }
          fs.renameSync(`${target}.part`, target);
        }
        state.ready = target;
      }
    } catch (e) {
      state.error = e.code === 'ENOENT' ? 'No latest.json at the update source.' : e.message;
    }
    state.checking = false;
    emit();
  }

  // Runs the new installer silently and starts the app again. The app must quit first, so the files can be replaced.
  function install() {
    if (!state.ready || !fs.existsSync(state.ready)) return false;
    const exe = process.execPath;
    const script = `ping -n 3 127.0.0.1 >nul & "${state.ready}" /S & ping -n 2 127.0.0.1 >nul & start "" "${exe}"`;
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  }

  function schedule() {
    setTimeout(check, 30 * 1000);
    setInterval(check, CHECK_EVERY);
  }

  return { check, install, schedule, state: () => ({ ...state, current: app.getVersion() }) };
};
