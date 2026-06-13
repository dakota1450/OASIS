# Oasis — build clean, free distributables for both platforms:
#   dist\Oasis-Windows.zip   and   dist\Oasis-macOS.zip
# and copy them into docs\download\ so the GitHub Pages site can hand them out.
# Ships only what each platform needs, with empty data so nothing personal goes out.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'

Add-Type -AssemblyName System.IO.Compression.FileSystem

function WriteJson($path, $text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

# Build a zip with FORWARD-SLASH entry paths. Windows PowerShell 5.1's
# Compress-Archive writes backslash separators, which violate the ZIP spec —
# macOS/Linux then extract flat files literally named "public\app.js" instead of
# folders, and the app won't run. Writing entries by hand keeps it portable.
function New-CrossZip($stageDir, $zipPath) {
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  $base = (Resolve-Path $stageDir).Path.TrimEnd('\')
  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
  try {
    Get-ChildItem -LiteralPath $stageDir -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($base.Length + 1) -replace '\\','/'
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $zip.Dispose() }
}

# Stage the files every platform ships with: the server, the app, docs, fresh
# (empty) data, and an empty assets folder for the user's own images.
function Stage-Common($stage) {
  New-Item -ItemType Directory -Force -Path $stage | Out-Null

  foreach ($f in @('server.js','README.md','LICENSE.txt')) {
    $src = Join-Path $root $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $stage $f) -Force }
    else { Write-Host "  (skipped missing $f)" -ForegroundColor DarkYellow }
  }

  # the app itself
  Copy-Item (Join-Path $root 'public') (Join-Path $stage 'public') -Recurse -Force

  # fresh data: empty lists, plus one friendly welcome idea so Ideas isn't bare
  New-Item -ItemType Directory -Force -Path (Join-Path $stage 'data') | Out-Null
  WriteJson (Join-Path $stage 'data\notes.json')  '[{"id":"welcome00","text":"Welcome to Oasis. This is an idea. Pin it with the star, develop it into angles with the arrow, or clear it with the x.","created":"2026-01-01T00:00:00.000Z","pinned":false}]'
  WriteJson (Join-Path $stage 'data\tools.json')  '[]'
  WriteJson (Join-Path $stage 'data\sparks.json') '[]'
  WriteJson (Join-Path $stage 'data\todos.json')  '[]'
  WriteJson (Join-Path $stage 'data\journal.json') '[]'
  WriteJson (Join-Path $stage 'data\ask-history.json') '[]'
  WriteJson (Join-Path $stage 'data\briefings.json') '{}'
  WriteJson (Join-Path $stage 'data\config.json') '{}'

  # empty folder for the user's own imported/generated assets
  New-Item -ItemType Directory -Force -Path (Join-Path $stage 'assets') | Out-Null
  WriteJson (Join-Path $stage 'assets\README.txt') 'Images you import or keep in Oasis are stored here.'
}

function Build-Zip($name, $platformFiles) {
  $stage = Join-Path $dist $name
  $zip   = Join-Path $dist ("{0}.zip" -f $name)
  Stage-Common $stage
  foreach ($f in $platformFiles) {
    $src = Join-Path $root $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $stage $f) -Force }
    else { Write-Host "  (skipped missing $f)" -ForegroundColor DarkYellow }
  }
  New-CrossZip $stage $zip
  $mb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
  Write-Host ("  Built  {0}   ({1} MB)" -f $zip, $mb) -ForegroundColor Green
  return $zip
}

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# Windows ships the .bat/.vbs launchers, the PowerShell setup, and the icon.
$winZip = Build-Zip 'Oasis-Windows' @(
  'Oasis.vbs','Launch Oasis.bat','Setup Oasis.bat','setup.ps1','oasis.ico'
)

# macOS ships the double-clickable .command launchers and a plain-text guide.
# NOTE: zip archives don't carry the Unix executable bit, so the bundled
# 'START HERE (macOS).txt' (and the site FAQ) tell first-run users to either
# right-click → Open, or run  bash "Setup Oasis.command"  once (which chmods them).
$macZip = Build-Zip 'Oasis-macOS' @(
  'Launch Oasis.command','Setup Oasis.command','START HERE (macOS).txt'
)

# publish both into the GitHub Pages site so the Download buttons work
$dl = Join-Path $root 'docs\download'
New-Item -ItemType Directory -Force -Path $dl | Out-Null
Copy-Item $winZip (Join-Path $dl 'Oasis-Windows.zip') -Force
Copy-Item $macZip (Join-Path $dl 'Oasis-macOS.zip') -Force

# remove the old single-platform artifact if it's still lying around
$stale = Join-Path $dl 'Oasis.zip'
if (Test-Path $stale) { Remove-Item $stale -Force; Write-Host "  Removed stale docs\download\Oasis.zip" -ForegroundColor DarkYellow }

Write-Host ""
Write-Host "  Copied both zips into  docs\download\  (served by the marketing page)" -ForegroundColor Green
Write-Host "  Windows users run 'Setup Oasis.bat'; macOS users run 'Setup Oasis.command'."
Write-Host "  Commit and push docs\ to publish."
