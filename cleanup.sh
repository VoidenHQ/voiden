#!/bin/bash

# Voiden Cleanup Script
# Removes node_modules + caches, reinstalls, and builds all local plugin repos.
#
# Prerequisites: Plugin repos must be cloned into plugins/
#   If plugins/ is empty, run first: bash scripts/setup-plugins.sh

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "Starting Voiden cleanup..."
echo ""

# ─── Check plugin workspace ───────────────────────────────────────────────────
PLUGINS_DIR="$ROOT_DIR/plugins"
PLUGIN_COUNT=$(find "$PLUGINS_DIR" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')

if [ ! -d "$PLUGINS_DIR" ] || [ "$PLUGIN_COUNT" -eq 0 ]; then
  echo -e "${YELLOW}  ℹ No plugin repos found in plugins/${NC}"
  echo -e "${BLUE}  Run this first: bash scripts/setup-plugins.sh${NC}"
  echo ""
fi

# ─── Step 1: Remove node_modules (skip plugins/ — those are separate repos) ──
echo -e "${YELLOW}Removing node_modules...${NC}"
find . -path "./plugins" -prune -o -name "node_modules" -type d -prune -exec rm -rf '{}' +
echo -e "${GREEN}✓ Removed node_modules${NC}"
echo ""

# ─── Step 2: Remove dist folders (skip plugins/) ─────────────────────────────
echo -e "${YELLOW}Removing dist folders...${NC}"
find . -path "./plugins" -prune -o -name "dist" -type d -prune -exec rm -rf '{}' +
echo -e "${GREEN}✓ Removed dist folders${NC}"
echo ""

# ─── Step 3: Remove TypeScript build cache ────────────────────────────────────
echo -e "${YELLOW}Removing TypeScript build cache...${NC}"
find . -path "./plugins" -prune -o -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true
echo -e "${GREEN}✓ Removed TypeScript build cache${NC}"
echo ""

# ─── Step 4: Remove Vite / build caches ──────────────────────────────────────
echo -e "${YELLOW}Removing build caches...${NC}"
rm -rf apps/ui/node_modules/.vite apps/ui/.vite apps/electron/out 2>/dev/null || true
echo -e "${GREEN}✓ Removed build caches${NC}"
echo ""

# ─── Step 5: Fresh install ────────────────────────────────────────────────────
echo -e "${YELLOW}Running yarn install...${NC}"
yarn install
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# ─── Step 6: Build each plugin from local source ─────────────────────────────
if [ "$PLUGIN_COUNT" -gt 0 ]; then
  echo -e "${YELLOW}Building plugins from plugins/...${NC}"

  BUILT=0; FAILED=0

  for PLUGIN_DIR in "$PLUGINS_DIR"/*/; do
    [ -d "$PLUGIN_DIR" ] || continue
    BUILD_SCRIPT="$PLUGIN_DIR/build.mjs"
    MANIFEST="$PLUGIN_DIR/manifest.json"
    [ -f "$BUILD_SCRIPT" ] || continue
    [ -f "$MANIFEST" ] || continue

    PLUGIN_ID=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('id',''))" "$MANIFEST" 2>/dev/null)
    [ -z "$PLUGIN_ID" ] && continue

    echo -n "  $PLUGIN_ID... "

    # Reinstall plugin deps if missing
    if [ ! -d "$PLUGIN_DIR/node_modules" ]; then
      (cd "$PLUGIN_DIR" && npm install --no-package-lock --silent 2>/dev/null) || true
    fi

    BUILD_OK=true
    if ! (cd "$PLUGIN_DIR" && node build.mjs 2>/dev/null); then
      BUILD_OK=false
      ((FAILED++)) || true
    fi

    # Also build main-process bundle if the plugin has one
    if [ -f "$PLUGIN_DIR/build-main.mjs" ]; then
      if ! (cd "$PLUGIN_DIR" && node build-main.mjs 2>/dev/null); then
        BUILD_OK=false
      fi
    fi

    if $BUILD_OK && [ -f "$PLUGIN_DIR/dist/${PLUGIN_ID}.js" ]; then
      echo -e "${GREEN}✓${NC}"
      ((BUILT++)) || true
    elif $BUILD_OK; then
      echo -e "${YELLOW}built (no bundle)${NC}"
    else
      echo -e "${RED}✗${NC}"
    fi
  done

  echo ""
  echo -e "${GREEN}✓ Plugins: $BUILT built → plugins/<id>/dist/${NC}"
  [ "$FAILED" -gt 0 ] && echo -e "${RED}  ✗ $FAILED failed${NC}"
  echo ""
fi

echo -e "${GREEN}Cleanup complete!${NC}"
echo ""
echo "Next steps:"
echo "  Start app:              cd apps/electron && yarn start"
echo "  Build plugins once:     yarn dev:plugins"
echo "  Watch + hot-reload:     yarn plugins:dev"
echo ""
