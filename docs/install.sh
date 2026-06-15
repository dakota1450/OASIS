#!/bin/bash
# Oasis — one-line installer for macOS (and Linux).
#
#   curl -fsSL https://dakota1450.github.io/OASIS/install.sh | bash
#
# Why this exists: a .zip downloaded in a browser is tagged by macOS with a
# "quarantine" flag, and on recent macOS (Sequoia+) Gatekeeper blocks unsigned
# apps with NO "Open Anyway" button — so the double-click launchers can't start.
# Files fetched by curl/this script are NOT quarantined, so installing this way
# skips Gatekeeper completely. Nothing here needs an Apple Developer account, and
# it only ever touches your own home folder. Read the whole script before running
# it if you like — that's the point of a plain installer.
set -euo pipefail

BASE="${OASIS_BASE:-https://dakota1450.github.io/OASIS}"
APP_DIR="${OASIS_DIR:-$HOME/Applications/Oasis}"

say()  { printf '  %s\n' "$1"; }
ok()   { printf '  \033[0;32m%s\033[0m\n' "$1"; }
warn() { printf '  \033[0;33m%s\033[0m\n' "$1"; }
die()  { printf '  \033[0;31m%s\033[0m\n' "$1" >&2; exit 1; }

printf '\n'
say "Oasis — installer"
say "----------------------------------------"
printf '\n'

# --- Node.js is the only requirement ---
if ! command -v node >/dev/null 2>&1; then
  warn "Oasis needs Node.js (it's free) and it isn't installed yet."
  printf '\n'
  say "  Install the LTS build, then re-run this command:"
  say "    • https://nodejs.org/en/download"
  say "    • or, with Homebrew:   brew install node"
  printf '\n'
  exit 1
fi
say "Node.js $(node --version) found."

# --- download the packaged app into a temp dir (curl => no quarantine flag) ---
TMP="$(mktemp -d "${TMPDIR:-/tmp}/oasis.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
say "Downloading Oasis…"
# cache-bust so a CDN can't hand back a stale same-named zip
curl -fsSL "$BASE/download/Oasis-macOS.zip?ts=$(date +%s)" -o "$TMP/oasis.zip" \
  || die "Couldn't download Oasis. Check your connection and try again."

say "Unpacking…"
mkdir -p "$TMP/unzipped"
unzip -oq "$TMP/oasis.zip" -d "$TMP/unzipped" || die "The download couldn't be unpacked."

# the zip stages files at its root; locate server.js defensively in case an
# unzipper nests them one level down
SRC="$TMP/unzipped"
if [ ! -f "$SRC/server.js" ]; then
  found="$(find "$TMP/unzipped" -maxdepth 3 -name server.js -print 2>/dev/null | head -n1 || true)"
  [ -n "$found" ] && SRC="$(dirname "$found")"
fi
[ -f "$SRC/server.js" ] || die "The download didn't contain Oasis — aborting (nothing was changed)."

# --- preserve existing data/assets across a reinstall or update ---
if [ -d "$APP_DIR" ]; then
  say "Updating the copy already in $APP_DIR (keeping your data)…"
  [ -d "$APP_DIR/data" ]   && cp -R "$APP_DIR/data"   "$TMP/data-backup"   2>/dev/null || true
  [ -d "$APP_DIR/assets" ] && cp -R "$APP_DIR/assets" "$TMP/assets-backup" 2>/dev/null || true
  rm -rf "$APP_DIR"
fi

mkdir -p "$(dirname "$APP_DIR")"
mv "$SRC" "$APP_DIR"

# restore the preserved personal data over the fresh (empty) copy
if [ -d "$TMP/data-backup" ];   then rm -rf "$APP_DIR/data";   mv "$TMP/data-backup"   "$APP_DIR/data"; fi
if [ -d "$TMP/assets-backup" ]; then rm -rf "$APP_DIR/assets"; mv "$TMP/assets-backup" "$APP_DIR/assets"; fi

# belt-and-suspenders: clear any quarantine and make the launchers runnable
xattr -dr com.apple.quarantine "$APP_DIR" 2>/dev/null || true
chmod +x "$APP_DIR"/*.command 2>/dev/null || true

# a one-click Desktop launcher
ln -sf "$APP_DIR/Launch Oasis.command" "$HOME/Desktop/Launch Oasis.command" 2>/dev/null || true

ok "Installed to  $APP_DIR"
printf '\n'
say "Opening Oasis… (it runs at http://localhost:7777)"
# launch in the background so the pipe-to-bash returns cleanly
( cd "$APP_DIR" && nohup ./"Launch Oasis.command" >/dev/null 2>&1 & ) || true

printf '\n'
ok "Done. Oasis is open, and there's a 'Launch Oasis' launcher on your Desktop."
say "Tip: for the optional embedded terminal, run once:"
say "       ( cd \"$APP_DIR\" && npm install )"
printf '\n'
