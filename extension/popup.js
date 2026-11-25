'use strict';
const $ = (id) => document.getElementById(id);
const HELPER = 'http://127.0.0.1:17653';

async function refresh() {
  const { enabled, recent } = await chrome.storage.local.get({ enabled: true, recent: [] });
  $('enabled').checked = enabled;
  const r = await chrome.runtime.sendMessage({ type: 'ping' }).catch(() => null);
  const status = $('status');
  if (!r || !r.paired) { status.className = 'dot'; status.textContent = 'Not connected'; $('connect').hidden = false; }
  else if (!r.online) { status.className = 'dot'; status.textContent = 'K Downloader is not running'; $('connect').hidden = true; }
  else { status.className = 'dot ok'; status.textContent = 'Connected'; $('connect').hidden = true; }
  const box = $('recent');
  box.replaceChildren(...recent.map((e) => {
    const d = document.createElement('div');
    d.className = e.ok ? '' : 'err';
    d.title = e.url;
    d.textContent = `${e.ok ? e.label || 'Sent' : 'Failed'} · ${e.title}`;
    return d;
  }));
  if (!recent.length) box.textContent = 'Nothing sent yet.';
}

$('connect').addEventListener('click', () => chrome.tabs.create({ url: `${HELPER}/pair?ext=${chrome.runtime.id}` }));
$('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$('clear').addEventListener('click', async () => { await chrome.storage.local.set({ recent: [] }); refresh(); });
$('url').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const url = $('url').value.trim();
  if (!/^https?:\/\//i.test(url)) return;
  $('sent').textContent = 'Sending...';
  const r = await chrome.runtime.sendMessage({ type: 'send', url });
  $('sent').textContent = r.ok ? `Sent: ${r.job.label}` : r.error;
  if (r.ok) $('url').value = '';
  refresh();
});
refresh();
