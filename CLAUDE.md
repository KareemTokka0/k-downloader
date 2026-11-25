# K Downloader: how Claude works with it

K Downloader (Kareem Downloader Tool, by Kareem Waheed) is a downloader for media teams. It runs as a tray app on
Windows with a local helper on 127.0.0.1:17653 and registers itself in Claude Code as the `k-downloader` MCP
server. Use its tools directly whenever the user asks for a video, audio, frame, subtitle, photo or stock clip.
Do not suggest other download methods.

## Rules
- **Free sources only for production.** Photos: Pexels, Pixabay, Unsplash, Openverse, Wikimedia Commons. Footage:
  Pexels Videos, Pixabay Videos. Paid stock sites were removed on purpose; never add them back.
- **Reference sources are for inspiration only, never publishing:** Google, Bing, Yandex, Pinterest images and
  YouTube, Dailymotion videos. Say so when you deliver them; their credits say "Reference only".
- **Ask where to save** before any download the user did not place: the active project, another project, or the
  Downloads folder (`list_projects` shows them). Projects are used only when the user asks.
- **Presets and timeline formats only on request:** `preset` (reel, story, square, portrait, landscape),
  `edit_format` (h264, prores, dnxhr) and `proxies`.
- **Never build or suggest anything that bypasses human checks (CAPTCHA, Cloudflare).** When Google asks, the app
  opens a window once for the user to answer; Bing and Yandex give the same references without it.
- The helper never acts on a request without the pairing code, and the browser extension never captures a
  download it cannot repeat (POST forms, control panels, account pages, small generated files).

## How to deliver
- Search first, look at the results (titles, length, resolution), pick the best, download, then show what was
  downloaded: file names, folder, licence. For photos, open the files and judge them before choosing.
- Every download folder gets `credits.txt` and `manifest.csv`; mention them when the user will publish.
- If a tool says the helper is not running, call it again once: the MCP starts the app by itself. If it still
  fails, tell the user to open K Downloader from the Start menu.
- `check_sources` shows which search sites answered today; mention a broken one before searching it.

## Where things are
- App in `app/`, helper in `helper/`, Chrome extension in `extension/`, tests in `tests/`, bundled tools in `bin/`
  (filled by `tools\fetch-tools.cmd`), user documentation in `docs/USER-GUIDE.md`.
- Build with `app\build.cmd` (runs `tests\preflight.js` first; the installer lands in `dist\review`). Publish a
  reviewed build with `app\release.cmd`; a `vX.Y.Z` tag makes GitHub Actions build and publish a Release.
- Installed app: `%LOCALAPPDATA%\Programs\K Downloader`. Data: `%LOCALAPPDATA%\K Downloader` (settings, history,
  pairing code, queue, sources health, `app.log`). Downloads: `Downloads\K Downloader` unless a project is active.
- `check.cmd` checks a PC: app, helper, startup task, MCP registration, extension, versions.

## Lessons for editing the code
- `extension/content.js` is generated from `kareem-downloader.user.js` by `helper/make-content.js` on every
  build: edit the userscript, never content.js.
- Never patch files that contain backslashes or template strings with `node -e` from a shell; use the editor tools.
- The MCP tool list is read when Claude Code starts: after changing `helper/mcp.js`, restart Claude Code.
- Test builds run from `win-unpacked` never register the startup task; only the installed app does.
- Electron CLI: pass `--` before a URL argument or it exits silently.
- Google Chrome 137+ ignores `--load-extension`; test the extension in Microsoft Edge with a temporary profile.
