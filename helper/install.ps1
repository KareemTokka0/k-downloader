param(
  [string]$StartupDir = [Environment]::GetFolderPath('Startup'),
  [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$health = 'http://127.0.0.1:17653/health'
$scriptUrl = 'http://127.0.0.1:17653/kareem-downloader.user.js'

foreach ($tool in 'node.exe', 'yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe') {
  if (-not (Test-Path -LiteralPath (Join-Path $root "bin\$tool"))) {
    Write-Host "Missing bin\$tool. Copy the full Kareem Downloader folder again." -ForegroundColor Red
    exit 1
  }
}

$hidden = Join-Path $PSScriptRoot 'start-hidden.ps1'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $StartupDir 'Kareem Downloader.lnk'))
$link.TargetPath = 'powershell.exe'
$link.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$hidden`""
$link.WorkingDirectory = $root
$link.WindowStyle = 7
$link.Description = 'Kareem Downloader helper'
$link.Save()
Write-Host 'Helper will start automatically when you sign in.'

function Test-Helper {
  try { return (Invoke-RestMethod -Uri $health -TimeoutSec 2).app -eq 'kareem-downloader' } catch { return $false }
}

# A helper left running from an older copy would keep serving old code after an update.
$node = Join-Path $root 'bin\node.exe'
Get-Process -Name node -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $node } |
  Stop-Process -Force
Start-Sleep -Milliseconds 500
& $hidden
$ready = $false
for ($i = 0; $i -lt 20 -and -not $ready; $i++) {
  Start-Sleep -Milliseconds 500
  $ready = Test-Helper
}
if (-not $ready) {
  Write-Host 'The helper did not start. Try start.cmd to see the error.' -ForegroundColor Red
  exit 1
}
Write-Host 'Helper is running.'

# Registers the MCP server for Claude Code (user scope), so Claude can drive downloads.
$claudeConfig = Join-Path $env:USERPROFILE '.claude.json'
if (Test-Path -LiteralPath $claudeConfig) {
  try {
    $cfg = Get-Content -LiteralPath $claudeConfig -Raw | ConvertFrom-Json
    if (-not $cfg.mcpServers) { $cfg | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) }
    $entry = [pscustomobject]@{ type = 'stdio'; command = (Join-Path $root 'bin\node.exe'); args = @((Join-Path $root 'helper\mcp.js')); env = [pscustomobject]@{} }
    $cfg.mcpServers | Add-Member -NotePropertyName 'k-downloader' -NotePropertyValue $entry -Force
    $cfg | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $claudeConfig -Encoding utf8
    Write-Host 'Claude Code can now use K Downloader (restart Claude Code once).'
  } catch { Write-Host 'Could not register with Claude Code; the downloader still works.' -ForegroundColor Yellow }
}

if ($NoOpen) { exit 0 }

# OrangeMonkey lives in Chrome, which may not be the default browser.
$chrome = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)'
if (-not $chrome) {
  $chrome = (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)'
}
if ($chrome) { Start-Process -FilePath $chrome -ArgumentList $scriptUrl } else { Start-Process $scriptUrl }

Write-Host ''
Write-Host 'Last step: press the install button in the OrangeMonkey tab that just opened.' -ForegroundColor Green
