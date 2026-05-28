#!/bin/bash
# Voiden Plugin Setup Script
# Clones/pulls plugin repos, installs deps, syncs registry snapshot, and builds plugins.
# Run this once after a fresh checkout or when adding new plugins to the registry.

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PLUGINS_DIR="$ROOT_DIR/plugins"
mkdir -p "$PLUGINS_DIR"

fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
step() { echo -e "${YELLOW}$1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }

# ─── Step 1: Clone or pull core-plugins-registry ─────────────────────────────
step "Step 1: core-plugins-registry"
REGISTRY_DIR="$PLUGINS_DIR/core-plugins-registry"
if [ -d "$REGISTRY_DIR" ]; then
  echo "  Pulling core-plugins-registry..."
  git -C "$REGISTRY_DIR" pull || fail "Failed to pull core-plugins-registry"
else
  echo "  Cloning core-plugins-registry..."
  git clone https://github.com/VoidenHQ/core-plugins-registry.git "$REGISTRY_DIR" \
    || fail "Failed to clone core-plugins-registry"
fi
ok "core-plugins-registry ready"
echo ""

# ─── Step 2: Clone or pull each plugin listed in registry.json ───────────────
step "Step 2: Plugin repos"
REGISTRY_JSON="$REGISTRY_DIR/registry.json"
[ -f "$REGISTRY_JSON" ] || fail "$REGISTRY_JSON not found after clone"

# Parse plugin list using Node (avoids a Python/jq dependency)
PLUGIN_LIST=$(node -e "
  const r = JSON.parse(require('fs').readFileSync('$REGISTRY_JSON', 'utf8'));
  const plugins = Object.values(r.plugins || {});
  plugins.forEach(p => { if (p.id && p.repo) console.log(p.id + ' ' + p.repo); });
" 2>/dev/null) || fail "Failed to parse $REGISTRY_JSON"

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

# ─── Step 3: yarn install ─────────────────────────────────────────────────────
step "Step 3: yarn install"
yarn install || fail "yarn install failed"
ok "Dependencies installed"
echo ""

# ─── Step 4: Sync registry snapshot ──────────────────────────────────────────
step "Step 4: registry:sync"
node scripts/sync-registry.mjs || fail "registry:sync failed"
ok "Registry snapshot synced"
echo ""

# ─── Step 5: Build all plugins ───────────────────────────────────────────────
step "Step 5: Build plugins"
BUILT=0; FAILED=0

for PLUGIN_DIR in "$PLUGINS_DIR"/*/; do
  [ -d "$PLUGIN_DIR" ] || continue
  MANIFEST="$PLUGIN_DIR/manifest.json"
  [ -f "$MANIFEST" ] || continue

  PLUGIN_ID=$(node -e "try{const m=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));process.stdout.write(m.id||'')}catch{}" 2>/dev/null)
  [ -z "$PLUGIN_ID" ] && continue

  echo -n "  $PLUGIN_ID... "

  # Install plugin deps if missing
  if [ ! -d "$PLUGIN_DIR/node_modules" ] && [ -f "$PLUGIN_DIR/package.json" ]; then
    (cd "$PLUGIN_DIR" && npm install --no-package-lock --silent 2>/dev/null) || true
  fi

  BUILD_OK=true

  # Renderer bundle
  if [ -f "$PLUGIN_DIR/build.mjs" ]; then
    (cd "$PLUGIN_DIR" && node build.mjs 2>/dev/null) || BUILD_OK=false
  fi

  # Main-process bundle
  if [ -f "$PLUGIN_DIR/build-main.mjs" ]; then
    (cd "$PLUGIN_DIR" && node build-main.mjs 2>/dev/null) || BUILD_OK=false
  fi

  if $BUILD_OK; then
    echo -e "${GREEN}✓${NC}"
    ((BUILT++)) || true
  else
    echo -e "${RED}✗ (build failed)${NC}"
    ((FAILED++)) || true
  fi
done

echo ""
[ "$BUILT" -gt 0 ] && ok "$BUILT plugin(s) built → plugins/<id>/dist/"
[ "$FAILED" -gt 0 ] && echo -e "${RED}  ✗ $FAILED plugin(s) failed to build${NC}"
echo ""

# ─── Done ─────────────────────────────────────────────────────────────────────
echo -e "${GREEN}✅ Setup complete.${NC}"
echo ""
echo "Dev workflow:"
echo "  Terminal 1:  cd apps/electron && yarn start   ← Electron + UI dev server"
echo "  Terminal 2:  yarn plugins:dev                 ← watch + rebuild all plugins on change"
echo ""
echo "Registry scripts:"
echo "  yarn registry:sync              ← copy local registry clone → snapshot"
echo "  yarn registry:update            ← update registry from plugin manifests (local)"
echo "  yarn registry:update:push       ← same + push to VoidenHQ/core-plugins-registry"
