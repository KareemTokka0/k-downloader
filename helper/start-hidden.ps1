# Starts the helper with no window. Run at sign-in by the Startup shortcut.
$root = Split-Path -Parent $PSScriptRoot
Start-Process -FilePath (Join-Path $root 'bin\node.exe') `
  -ArgumentList ('"' + (Join-Path $root 'helper\server.js') + '"') `
  -WorkingDirectory $root -WindowStyle Hidden
