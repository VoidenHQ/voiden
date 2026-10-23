#!/bin/bash
# Apply Windows native module build patches after yarn install
# These fix MSVC 2022 compilation issues in node-gyp
#
# Patches:
#   1. win_delay_load_hook.cc - GetModuleHandle -> GetModuleHandleA
#
# node-pty used to be patched here too, by copying over whole node-pty 1.0.0
# source files. node-pty 1.1.0 is N-API (no nan), so those copies no longer
# compile against it. Its conpty.cc typedef fix now lives in
# .yarn/patches/node-pty-npm-1.1.0-*.patch (applied by yarn install), and
# 1.1.0's winpty.cc no longer has the goto that needed hoisting.
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

echo "Done. Now run: yarn rebuild"
