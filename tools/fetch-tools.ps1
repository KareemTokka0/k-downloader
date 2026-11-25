# Downloads the third-party programs K Downloader runs into bin\ from their official release pages.
# Run through tools\fetch-tools.cmd. Safe to run again: files already present are kept unless -Force is given.
param([switch]$Force)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'bin'
$tmp = Join-Path $env:TEMP 'kd-fetch-tools'
New-Item -ItemType Directory -Force $bin, (Join-Path $bin 'whisper'), $tmp | Out-Null

$NODE_VERSION = '26.13.0'
$ARIA2_VERSION = '1.37.0'
$versions = [ordered]@{}

function Fetch($name, $url, $file) {
  Write-Host "  downloading $name"
  Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
}
function Unzip($zip, $dest) {
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $dest -Force
}
function Have($file) { -not $Force -and (Test-Path (Join-Path $bin $file)) }

Write-Host "K Downloader tools -> $bin"

# Node.js: the helper and the MCP server run on this copy, not on whatever Node the PC has.
if (Have 'node.exe') { Write-Host '  node.exe present' } else {
  $zip = Join-Path $tmp 'node.zip'
  Fetch "Node.js $NODE_VERSION" "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" $zip
  Unzip $zip (Join-Path $tmp 'node')
  Copy-Item (Join-Path $tmp "node\node-v$NODE_VERSION-win-x64\node.exe") $bin -Force
}
$versions.node = (& (Join-Path $bin 'node.exe') --version).Trim()

# yt-dlp: the latest release; the app also updates it by itself later.
if (Have 'yt-dlp.exe') { Write-Host '  yt-dlp.exe present' } else {
  Fetch 'yt-dlp' 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' (Join-Path $bin 'yt-dlp.exe')
}
$versions.ytdlp = (& (Join-Path $bin 'yt-dlp.exe') --version).Trim()

# FFmpeg: BtbN's GPL static build (ffmpeg + ffprobe).
if ((Have 'ffmpeg.exe') -and (Have 'ffprobe.exe')) { Write-Host '  ffmpeg.exe present' } else {
  $zip = Join-Path $tmp 'ffmpeg.zip'
  Fetch 'FFmpeg (BtbN gpl build)' 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' $zip
  Unzip $zip (Join-Path $tmp 'ffmpeg')
  $dir = Get-ChildItem (Join-Path $tmp 'ffmpeg') -Directory | Select-Object -First 1
  Copy-Item (Join-Path $dir.FullName 'bin\ffmpeg.exe'), (Join-Path $dir.FullName 'bin\ffprobe.exe') $bin -Force
}
$versions.ffmpeg = ((& (Join-Path $bin 'ffmpeg.exe') -version 2>&1 | Select-Object -First 1) -replace '^ffmpeg version\s+', '' -replace ' Copyright.*$', '').Trim()

# aria2: multi-connection downloads.
if (Have 'aria2c.exe') { Write-Host '  aria2c.exe present' } else {
  $zip = Join-Path $tmp 'aria2.zip'
  Fetch "aria2 $ARIA2_VERSION" "https://github.com/aria2/aria2/releases/download/release-$ARIA2_VERSION/aria2-$ARIA2_VERSION-win-64bit-build1.zip" $zip
  Unzip $zip (Join-Path $tmp 'aria2')
  Copy-Item (Get-ChildItem (Join-Path $tmp 'aria2') -Recurse -Filter 'aria2c.exe' | Select-Object -First 1).FullName $bin -Force
}
$versions.aria2 = ((& (Join-Path $bin 'aria2c.exe') --version | Select-Object -First 1) -replace '^aria2 version\s+', '').Trim()

# whisper.cpp: CPU build; the app downloads the CUDA build itself on NVIDIA PCs.
if (Have 'whisper\whisper-cli.exe') { Write-Host '  whisper-cli.exe present' } else {
  $zip = Join-Path $tmp 'whisper.zip'
  Fetch 'whisper.cpp (x64)' 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip' $zip
  Unzip $zip (Join-Path $tmp 'whisper')
  $cli = Get-ChildItem (Join-Path $tmp 'whisper') -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
  Get-ChildItem $cli.DirectoryName -File | Where-Object { $_.Extension -in '.exe', '.dll' } | Copy-Item -Destination (Join-Path $bin 'whisper') -Force
}
$versions.whisper = 'whisper.cpp ' + (Get-Item (Join-Path $bin 'whisper\whisper-cli.exe')).LastWriteTime.ToString('yyyy-MM-dd')

$versions.fetched = (Get-Date).ToString('s')
($versions | ConvertTo-Json) | Set-Content (Join-Path $bin 'versions.json') -Encoding utf8
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "done:"
$versions.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-8} {1}" -f $_.Key, $_.Value) }
