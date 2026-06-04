#!/bin/bash

# Voiden Cleanup Script
# Clones/pulls plugin repos, removes node_modules + caches, reinstalls, and builds all local plugin repos.

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
step() { echo -e "${YELLOW}$1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }

# ─── Argument parsing ────────────────────────────────────────────────────────
SKIP_INSTALL=false
for arg in "$@"; do
  case $arg in
    --skip-install) SKIP_INSTALL=true ;;
    --help|-h)
      echo "Usage: $0 [--skip-install]"
      echo ""
      echo "  --skip-install   Skip removing node_modules and running yarn install"
      exit 0 ;;
    *) echo -e "${RED}Unknown argument: $arg${NC}"; exit 1 ;;
  esac
done

echo "Starting Voiden cleanup..."
[ "$SKIP_INSTALL" = true ] && echo -e "${YELLOW}(--skip-install: skipping node_modules removal and yarn install)${NC}"
echo ""

PLUGINS_DIR="$ROOT_DIR/plugins"
mkdir -p "$PLUGINS_DIR"

# ─── Step 1: Clone or pull plugin-registry ───────────────────────────────────
step "Step 1: plugin-registry"
REGISTRY_DIR="$PLUGINS_DIR/plugin-registry"
if [ -d "$REGISTRY_DIR" ]; then
  echo "  Pulling plugin-registry..."
  git -C "$REGISTRY_DIR" pull || fail "Failed to pull plugin-registry"
else
  echo "  Cloning plugin-registry..."
  git clone https://github.com/VoidenHQ/plugin-registry.git "$REGISTRY_DIR" \
    || fail "Failed to clone plugin-registry"
fi
ok "plugin-registry ready"
echo ""

# ─── Step 2: Clone or pull each plugin listed in extensions.json ─────────────
step "Step 2: Plugin repos"
REGISTRY_JSON="$REGISTRY_DIR/extensions.json"
[ -f "$REGISTRY_JSON" ] || fail "$REGISTRY_JSON not found after clone"

PLUGIN_LIST=$(node -e "
  const r = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  const plugins = Array.isArray(r) ? r.filter(p => p.type === 'core') : [];
  plugins.forEach(p => { if (p.id && p.repo) console.log(p.id + ' ' + p.repo); });
" "$REGISTRY_JSON" 2>/dev/null) || fail "Failed to parse $REGISTRY_JSON"

if [ -z "$PLUGIN_LIST" ]; then
  echo "  No plugins with repo entries found in registry — skipping clone step."
else
  while IFS=' ' read -r PLUGIN_ID REPO; do
    [ -z "$PLUGIN_ID" ] && continue
    PLUGIN_DIR="$PLUGINS_DIR/$PLUGIN_ID"
    echo -n "  $PLUGIN_ID... "
    if [ -d "$PLUGIN_DIR" ]; then
      git -C "$PLUGIN_DIR" pull --quiet 2>/dev/null && echo -e "${GREEN}pulled${NC}" || echo -e "${YELLOW}already up to date${NC}"
    else
      git clone "https://github.com/${REPO}.git" "$PLUGIN_DIR" --quiet \
        && echo -e "${GREEN}cloned${NC}" \
        || { echo -e "${RED}failed${NC}"; }
    fi
  done <<< "$PLUGIN_LIST"
fi
ok "Plugin repos ready"
echo ""

PLUGIN_COUNT=$(find "$PLUGINS_DIR" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')

# ─── Step 3: Remove node_modules (skip plugins/ — those are separate repos) ──
if [ "$SKIP_INSTALL" = true ]; then
  echo -e "${YELLOW}Skipping node_modules removal (--skip-install)${NC}"
else
  echo -e "${YELLOW}Removing node_modules...${NC}"
  find . -path "./plugins" -prune -o -name "node_modules" -type d -prune -exec rm -rf '{}' +
  echo -e "${GREEN}✓ Removed node_modules${NC}"
fi
echo ""

# ─── Step 4: Remove dist folders (skip plugins/) ─────────────────────────────
echo -e "${YELLOW}Removing dist folders...${NC}"
find . -path "./plugins" -prune -o -path "*/node_modules/*" -prune -o -name "dist" -type d -prune -exec rm -rf '{}' +
echo -e "${GREEN}✓ Removed dist folders${NC}"
echo ""

# ─── Step 5: Remove TypeScript build cache ────────────────────────────────────
echo -e "${YELLOW}Removing TypeScript build cache...${NC}"
find . -path "./plugins" -prune -o -path "*/node_modules/*" -prune -o -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true
echo -e "${GREEN}✓ Removed TypeScript build cache${NC}"
echo ""

# ─── Step 6: Remove Vite / build caches ──────────────────────────────────────
if [ "$SKIP_INSTALL" = true ]; then
  echo -e "${YELLOW}Skipping Vite/build cache removal (--skip-install)${NC}"
else
  echo -e "${YELLOW}Removing build caches...${NC}"
  rm -rf apps/ui/node_modules/.vite apps/ui/.vite apps/electron/out 2>/dev/null || true
  echo -e "${GREEN}✓ Removed build caches${NC}"
fi
echo ""

# ─── Step 7: Fresh install ────────────────────────────────────────────────────
if [ "$SKIP_INSTALL" = true ]; then
  echo -e "${YELLOW}Skipping yarn install (--skip-install)${NC}"
else
  echo -e "${YELLOW}Running yarn install...${NC}"
  yarn install
  echo -e "${GREEN}✓ Dependencies installed${NC}"
fi
echo ""

# ─── Step 8: Build each plugin from local source ─────────────────────────────
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
