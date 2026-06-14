#!/bin/bash
# Fully restart Oasis so a freshly updated version actually loads.
#
# Why: "Launch Oasis" reuses an already-running server (it just opens the window).
# node reads server.js once at startup, so after an update the OLD process keeps
# serving the OLD version until it is truly stopped. This stops whatever is
# listening on Oasis's port (7777), then launches fresh.
cd "$(dirname "$0")" || exit 1
echo "Restarting Oasis..."
PIDS=$(lsof -ti tcp:7777 2>/dev/null)
if [ -n "$PIDS" ]; then kill $PIDS 2>/dev/null; sleep 0.8; fi
exec "$(dirname "$0")/Launch Oasis.command"
