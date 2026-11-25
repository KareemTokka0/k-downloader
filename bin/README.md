# bin

The third-party programs K Downloader runs. They are not in the repository: run `tools\fetch-tools.cmd` once
and this folder fills itself with the official builds (about 450 MB):

- `node.exe` (Node.js 26, runs the helper and the MCP server)
- `yt-dlp.exe`
- `ffmpeg.exe`, `ffprobe.exe` (BtbN GPL static build)
- `aria2c.exe`
- `whisper\whisper-cli.exe` and its DLLs (whisper.cpp, CPU build; the app offers the CUDA build on NVIDIA PCs)

`tools\fetch-tools.cmd` writes `bin\versions.json` with what it downloaded, so every build records the exact
versions it shipped. Licences: `THIRD-PARTY-NOTICES.md`.
