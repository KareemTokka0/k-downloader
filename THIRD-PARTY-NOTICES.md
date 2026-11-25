# Third-party components

K Downloader's own code is MIT-licensed (see `LICENSE`). The installer also bundles these programs, each under
its own licence. `tools\fetch-tools.cmd` downloads them from their official release pages; nothing is modified.

| Component | What it does here | Licence | Source |
|---|---|---|---|
| yt-dlp | Finds and downloads video and audio from sites | Unlicense (public domain) | https://github.com/yt-dlp/yt-dlp |
| FFmpeg (BtbN static build, `--enable-gpl --enable-version3`) | Merges, cuts, converts, makes proxies and frames | GPL v3 | https://github.com/BtbN/FFmpeg-Builds (sources: https://ffmpeg.org) |
| aria2 | Multi-connection file downloads with resume | GPL v2 or later | https://github.com/aria2/aria2 |
| whisper.cpp | Speech to text on this PC (subtitles) | MIT | https://github.com/ggml-org/whisper.cpp |
| Whisper models (ggml) | Speech models downloaded on first use | MIT (OpenAI Whisper weights) | https://huggingface.co/ggerganov/whisper.cpp |
| Node.js | Runs the helper and the MCP server | MIT (and the licences of its dependencies) | https://nodejs.org |
| Electron | The desktop app shell | MIT | https://github.com/electron/electron |
| electron-builder / NSIS | Builds the Windows installer | MIT / zlib | https://www.electron.build |

## GPL notice

FFmpeg and aria2 are distributed with the installer unmodified, as binaries from their official builds. Under the
GPL you are entitled to their complete source code: the links above lead to it, and each release of this project
records the exact versions it shipped (`bin\README.md` and the release notes). K Downloader runs them as separate
programs and does not link against them.
