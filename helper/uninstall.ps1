param([string]$StartupDir = [Environment]::GetFolderPath('Startup'))

$link = Join-Path $StartupDir 'Kareem Downloader.lnk'
if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link }

$root = Split-Path -Parent $PSScriptRoot
$node = Join-Path $root 'bin\node.exe'
Get-Process -Name node -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $node } |
  Stop-Process -Force

Write-Host 'Helper stopped and removed from startup.'
Write-Host 'To finish, press Remove on K Downloader in OrangeMonkey.'
Write-Host "Your history and pairing code stay in $env:LOCALAPPDATA\K Downloader. Delete that folder to remove them."
