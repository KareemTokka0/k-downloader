@echo off
title K Downloader
cd /d "%~dp0"
if not exist "bin\yt-dlp.exe" goto missing
if not exist "bin\ffmpeg.exe" goto missing
if not exist "bin\node.exe" goto missing
"bin\node.exe" "helper\server.js"
echo.
pause
exit /b

:missing
echo The bin folder is incomplete. Copy the full Kareem Downloader folder again.
pause
