# Oasis - build a clean, free distributable into dist\Oasis.zip and copy it into
# docs\download\Oasis.zip so the GitHub Pages site can hand it out directly.
# Ships only what the app needs, with empty data so nothing personal goes out.
$ErrorActionPreference = 'Stop'
$root  = $PSScriptRoot
$dist  = Join-Path $root 'dist'
$stage = Join-Path $dist 'Oasis'
$zip   = Join-Path $dist 'Oasis.zip'

function WriteJson($path, $text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# top-level files the app ships with
foreach ($f in @('server.js','Oasis.vbs','Launch Oasis.bat','Setup Oasis.bat','setup.ps1','oasis.ico','README.md','LICENSE.txt')) {
  $src = Join-Path $root $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $stage $f) -Force } else { Write-Host "  (skipped missing $f)" -ForegroundColor DarkYellow }
}

# the app itself
Copy-Item (Join-Path $root 'public') (Join-Path $stage 'public') -Recurse -Force

# fresh data: empty lists, plus one friendly welcome idea so the Ideas tab isn't bare
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

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 2)

# publish the same zip into the GitHub Pages site so the Download button works
$dl = Join-Path $root 'docs\download'
New-Item -ItemType Directory -Force -Path $dl | Out-Null
Copy-Item $zip (Join-Path $dl 'Oasis.zip') -Force

Write-Host ""
Write-Host ("  Built  $zip   ($mb MB)") -ForegroundColor Green
Write-Host ("  Copied to  docs\download\Oasis.zip  (served by the marketing page)") -ForegroundColor Green
Write-Host  "  Users unzip and run 'Setup Oasis.bat'. Commit and push docs\ to publish."
