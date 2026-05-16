#!/usr/bin/env bash
# Installs the Arena desktop launcher for the current user.
# Run from anywhere — it finds the project root relative to this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ICON_PATH="$PROJECT_DIR/assets/arena-icon.png"
LAUNCH_SCRIPT="$PROJECT_DIR/scripts/launch-arena.sh"
DESKTOP_SRC="$SCRIPT_DIR/Arena.desktop"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_DEST="$DESKTOP_DIR/Arena.desktop"

echo "Project : $PROJECT_DIR"
echo "Icon    : $ICON_PATH"

# Make launch script executable
chmod +x "$LAUNCH_SCRIPT"

# Write a personalised .desktop file with real absolute paths
mkdir -p "$DESKTOP_DIR"
sed "s|Exec=.*|Exec=/bin/bash -lc 'cd \"$PROJECT_DIR\" \&\& exec \"$LAUNCH_SCRIPT\"'|;
     s|Icon=.*|Icon=$ICON_PATH|" \
  "$DESKTOP_SRC" > "$DESKTOP_DEST"

chmod +x "$DESKTOP_DEST"

# Trust the file so GNOME/Nautilus will launch it without the "Untrusted" warning
if command -v gio &>/dev/null; then
  gio set "$DESKTOP_DEST" metadata::trusted true 2>/dev/null || true
fi

# Refresh application database
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo ""
echo "✓ Installed to $DESKTOP_DEST"
echo ""
echo "To also put it on your desktop:"
echo "  cp \"$DESKTOP_DEST\" ~/Desktop/Arena.desktop"
echo "  chmod +x ~/Desktop/Arena.desktop"
echo "  gio set ~/Desktop/Arena.desktop metadata::trusted true"
echo ""
echo "Or pin 'Arena' from your app launcher."
