# Oasis - first-run setup for a fresh download.
# Checks for Node.js, drops a desktop shortcut, and opens Oasis. Free - no key, no account.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host ""
Write-Host "  Oasis - setup" -ForegroundColor Cyan
Write-Host "  ----------------------------------------"
Write-Host ""

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "  Oasis needs Node.js (it's free) and it isn't installed yet." -ForegroundColor Red
  Write-Host ""
  Write-Host "    1. Install the LTS build from  https://nodejs.org/en/download"
  Write-Host "    2. Run this setup again."
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}
Write-Host ("  Node.js {0} found." -f (node --version))

# Desktop shortcut -> Oasis.vbs (silent launcher), using the app icon.
try {
  $ws  = New-Object -ComObject WScript.Shell
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Oasis.lnk'
  $s   = $ws.CreateShortcut($lnk)
  $s.TargetPath       = 'wscript.exe'
  $s.Arguments        = '"' + (Join-Path $root 'Oasis.vbs') + '"'
  $s.WorkingDirectory = $root
  $ico = Join-Path $root 'oasis.ico'
  if (Test-Path $ico) { $s.IconLocation = $ico }
  $s.Description = 'Oasis'
  $s.Save()
  Write-Host "  Desktop shortcut created."
} catch {
  Write-Host "  (Could not create a desktop shortcut - you can still open 'Launch Oasis.bat'.)" -ForegroundColor DarkYellow
}

Write-Host "  Opening Oasis..."
Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $root 'Oasis.vbs') + '"')

Write-Host ""
Write-Host "  Oasis will open in its own window and walk you through a one-minute setup."
Write-Host "  Everything stays on this machine - no account, nothing phoned home."
Write-Host "  You can close this window."
Start-Sleep -Seconds 3
