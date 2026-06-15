#!/bin/bash
# Oasis — first-run setup for macOS. Run once after unzipping.
# Checks for Node.js, makes the launchers runnable, drops a Desktop launcher,
# and opens Oasis. Free — no key, no account.
cd "$(dirname "$0")" || exit 1

echo ""
echo "  Oasis — setup"
echo "  ----------------------------------------"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  Oasis needs Node.js (it's free) and it isn't installed yet."
  echo ""
  echo "    1. Install the LTS build from  https://nodejs.org/en/download"
  echo "       (or, with Homebrew:  brew install node)"
  echo "    2. Run this setup again."
  echo ""
  read -n 1 -s -r -p "  Press any key to close..."
  echo ""
  exit 1
fi
echo "  Node.js $(node --version) found."

# Make the launch scripts double-clickable from Finder.
chmod +x "Launch Oasis.command" "Restart Oasis.command" "Setup Oasis.command" 2>/dev/null

# Drop a Desktop launcher so Oasis is one click away.
LINK="$HOME/Desktop/Launch Oasis.command"
if ln -sf "$PWD/Launch Oasis.command" "$LINK" 2>/dev/null; then
  echo "  Desktop launcher created."
else
  echo "  (Could not create a Desktop launcher — you can still open 'Launch Oasis.command'.)"
fi

echo "  Opening Oasis..."
"./Launch Oasis.command" >/dev/null 2>&1 &

echo ""
echo "  Oasis will open in its own window and walk you through a one-minute setup."
echo "  Everything stays on this machine — no account, nothing phoned home."
echo "  You can close this window."
sleep 3
