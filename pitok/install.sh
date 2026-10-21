#!/usr/bin/env bash
# Install pitok so it is on your PATH.
#
#   1. Copies the tool to ~/.pi/agent/bin (pi's tool dir) or $PITOK_INSTALL_DIR
#   2. Symlinks it into ~/.local/bin (already on PATH for most shells)
#   3. Ensures ~/.pi/agent/bin is on PATH in ~/.bashrc for new shells
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/pitok"
DEST_DIR="${PITOK_INSTALL_DIR:-$HOME/.pi/agent/bin}"

mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST_DIR/pitok"
chmod +x "$DEST_DIR/pitok"

if [ -d "$HOME/.local/bin" ]; then
    ln -sf "$DEST_DIR/pitok" "$HOME/.local/bin/pitok"
elif ! command -v pitok >/dev/null 2>&1; then
    echo "note: ~/.local/bin not found; make sure $DEST_DIR is on your PATH" >&2
fi

if [ -f "$HOME/.bashrc" ] && ! grep -q 'pi/agent/bin' "$HOME/.bashrc"; then
    printf '\n# pi agent tools (pitok etc.)\nexport PATH="$HOME/.pi/agent/bin:$PATH"\n' \
        >> "$HOME/.bashrc"
    echo "updated ~/.bashrc (PATH += $DEST_DIR)"
fi

echo "installed: $DEST_DIR/pitok"
echo "run: pitok"
