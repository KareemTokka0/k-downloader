# K Downloader

**Kareem Downloader Tool.** A Windows download manager for media teams: video up to 4K and audio from YouTube,
Facebook, Instagram, TikTok and hundreds of sites, plain files with 16 connections and resume, free stock photos
and footage, speech-to-text subtitles on your own PC, and a Claude Code integration that does all of it from a
chat. No ads, no accounts, no tracking.

Made by [Kareem Waheed](https://www.linkedin.com/in/kareemtokka/). MIT licence.

## Status, read this first

- **The installer is not code-signed.** Windows SmartScreen says "unknown publisher" the first time: choose
  *More info*, *Run anyway*. Antivirus programs (Avast CyberCapture and others) scan it once and let it run.
  Signing costs money the project does not spend; the source is here so you can build it yourself.
- **The browser extension is not on the Chrome Web Store.** You load it once from the app's folder
  (`chrome://extensions`, Developer mode, *Load unpacked*). The app's first-run page walks you through it.
- Windows 10/11, 64-bit. A macOS port is planned.

## Install

1. Download `K-Downloader-Setup-x.y.z.exe` from the [latest release](https://github.com/KareemTokka0/k-downloader/releases/latest).
2. Run it. The app sits in the tray, starts with Windows and shows a three-step setup page.
3. Optional: load the browser extension (step 1 of the setup page) and restart Claude Code (step 2) so it sees
   the `k-downloader` tools.

Updates: the app checks the release page itself (Settings, *Update source*) and installs new versions quietly.

## What it does

| | |
|---|---|
| **Video and audio** | Any site yt-dlp supports. Up to 4K, MP3/M4A/WAV, a time range, a single frame, subtitles embedded or burned in, playlists and channels (latest N). |
| **Any file** | The extension hands the browser's downloads to the app: 16 parallel connections, resume after a dropped line, the page's cookies for files behind a login. It never takes what it cannot repeat: form exports, control panels, account pages, small generated files. Every saved file is checked; an error page saved under a file's name is refused, never reported as success. |
| **Free photos and footage** | Pexels, Pixabay, Unsplash, Openverse, Wikimedia Commons; Pexels and Pixabay video. Google, Bing, Yandex, Pinterest, YouTube and Dailymotion as *reference only*. Every folder gets `credits.txt` and `manifest.csv`. |
| **Subtitles by AI** | whisper.cpp on this PC (CPU, or CUDA on NVIDIA), translation, SRT, embed or burn. |
| **For the timeline** | H.264, ProRes, DNxHR, 540p proxies, social presets (reel, story, square, portrait, landscape), project folders with buckets. |
| **Claude Code** | 25 MCP tools: `search_images`, `download_videos`, `build_asset_pack` (a shot list becomes a folder), `download_playlist`, `transcribe`, projects, source health. Registered automatically on every start. |
| **Built to be relied on** | Runs as a service-like tray app with a start-up task that retries, a queue that survives restarts, retries for flaky sites, a daily health check of every search source, and `app.log`. |

Full user documentation: [docs/USER-GUIDE.md](docs/USER-GUIDE.md).

## Build from source

```
git clone https://github.com/KareemTokka0/k-downloader.git
cd k-downloader
tools\fetch-tools.cmd
app\build.cmd
```

`tools\fetch-tools.cmd` downloads the bundled programs (yt-dlp, FFmpeg, aria2, whisper.cpp, Node.js) from their
official releases into `bin\`. `app\build.cmd` runs `tests\preflight.js` (syntax, unit tests, the extension's
decisions in a fake Chrome, then a real helper doing real downloads) and leaves the installer in `dist\review`.
Tagging `vX.Y.Z` makes GitHub Actions build and publish a release.

## Privacy and security

The helper listens on `127.0.0.1` only and rejects any request without the pairing code kept in
`%LOCALAPPDATA%\K Downloader`. Cookies from the app's own browser live in a temporary file deleted when the helper
stops. Nothing is sent anywhere except to the sites you download from and to the official yt-dlp update.
See [SECURITY.md](SECURITY.md).

## Licences

K Downloader is MIT. It bundles yt-dlp (Unlicense), FFmpeg (GPL v3 build), aria2 (GPL v2+), whisper.cpp (MIT),
Node.js and Electron (MIT): see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
