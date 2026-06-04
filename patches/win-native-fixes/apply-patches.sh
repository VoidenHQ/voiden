#!/bin/bash
# Apply Windows native module build patches after yarn install
# These fix MSVC 2022 + C++20 compilation issues in node-pty and node-gyp
#
# Patches:
#   1. win_delay_load_hook.cc - GetModuleHandle -> GetModuleHandleA
#   2. conpty.cc - Move PFN* typedefs outside #ifndef guard (newer Windows SDK)
#   3. winpty.cc - Hoist variable declarations before goto (C++20 compliance)
#
# Usage: bash patches/win-native-fixes/apply-patches.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Applying Windows native build patches..."

# 1. node-gyp win_delay_load_hook.cc (both root and electron workspace)
for target in \
  "$ROOT_DIR/node_modules/node-gyp/src/win_delay_load_hook.cc" \
  "$ROOT_DIR/apps/electron/node_modules/node-gyp/src/win_delay_load_hook.cc"; do
  if [ -f "$target" ]; then
    cp "$SCRIPT_DIR/win_delay_load_hook.cc" "$target"
    echo "  Patched: $target"
  fi
done

# 2. node-pty conpty.cc
TARGET="$ROOT_DIR/apps/electron/node_modules/node-pty/src/win/conpty.cc"
if [ -f "$TARGET" ]; then
  cp "$SCRIPT_DIR/conpty.cc" "$TARGET"
  echo "  Patched: $TARGET"
fi

# 3. node-pty winpty.cc
TARGET="$ROOT_DIR/apps/electron/node_modules/node-pty/src/win/winpty.cc"
if [ -f "$TARGET" ]; then
  cp "$SCRIPT_DIR/winpty.cc" "$TARGET"
  echo "  Patched: $TARGET"
fi

echo "Done. Now run: yarn rebuild"
