#!/bin/bash
# Oasis — silent launcher for macOS.
# Starts the local server if it isn't already running, waits until it answers,
# then opens Oasis as its own app window (Chrome/Edge/Brave --app) or, failing
# that, in your default browser.

# Resolve the REAL script directory through any symlinks. Setup drops a Desktop
# launcher that is a symlink to this file, so a plain `dirname "$0"` would cd into
# ~/Desktop (no server.js there) and Oasis would never start.
SOURCE="$0"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  case "$SOURCE" in /*) ;; *) SOURCE="$DIR/$SOURCE" ;; esac
done
cd "$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)" || exit 1

PORT=7777
URL="http://127.0.0.1:${PORT}/"

is_up() { curl -s -o /dev/null --max-time 1 "$URL"; }

# --- start the server hidden if it isn't up, then wait for it ---
if ! is_up; then
  nohup node server.js > oasis.log 2>&1 &
  for _ in $(seq 1 40); do
    sleep 0.25
    if is_up; then break; fi
  done
fi

# --- open as a standalone app window if a Chromium browser is present ---
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
PROFILE="$HOME/Library/Application Support/OasisApp"

if [ -x "$CHROME" ]; then
  "$CHROME" --app="http://127.0.0.1:${PORT}" --window-size=1480,940 --user-data-dir="$PROFILE" >/dev/null 2>&1 &
elif [ -x "$EDGE" ]; then
  "$EDGE" --app="http://127.0.0.1:${PORT}" --window-size=1480,940 --user-data-dir="$PROFILE" >/dev/null 2>&1 &
elif [ -x "$BRAVE" ]; then
  "$BRAVE" --app="http://127.0.0.1:${PORT}" --window-size=1480,940 --user-data-dir="$PROFILE" >/dev/null 2>&1 &
else
  open "http://127.0.0.1:${PORT}"
fi
