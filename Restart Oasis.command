#!/bin/bash
# Fully restart Oasis so a freshly updated version actually loads.
#
# Why: "Launch Oasis" reuses an already-running server (it just opens the window).
# node reads server.js once at startup, so after an update the OLD process keeps
# serving the OLD version until it is truly stopped. This stops whatever is
# listening on Oasis's port (7777), then launches fresh.
# Resolve the REAL script directory through any symlinks before we cd/exec, so
# this works even when launched via a Desktop symlink (dirname "$0" alone would
# point at ~/Desktop, where there is no server.js / Launch script).
SOURCE="$0"
while [ -h "$SOURCE" ]; do
  D="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  case "$SOURCE" in /*) ;; *) SOURCE="$D/$SOURCE" ;; esac
done
DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
cd "$DIR" || exit 1
echo "Restarting Oasis..."
PIDS=$(lsof -ti tcp:7777 2>/dev/null)
if [ -n "$PIDS" ]; then kill $PIDS 2>/dev/null; sleep 0.8; fi
exec "$DIR/Launch Oasis.command"
