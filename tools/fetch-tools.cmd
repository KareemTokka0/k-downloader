@echo off
rem Fills bin\ with the official builds of yt-dlp, ffmpeg, aria2, whisper.cpp and Node.js. Run once after cloning.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fetch-tools.ps1" %*
