#!/bin/bash
# =============================================================================
# publish-snap.sh
#
# Generates snapcraft.yaml, builds the snap, and prints upload instructions.
# Auto-detects stable vs beta from the version in package.json.
# The yaml is generated into a temp directory — nothing is committed to this repo.
#
# Usage:
#   ./scripts/publish-snap.sh [channel]
#
# Arguments:
#   channel   Snap channel: stable | beta | edge
#             Defaults to "beta" if version contains "beta", otherwise "stable"
#
# Prerequisites:
#   - snapcraft installed: sudo snap install snapcraft --classic
#   - snapcraft login done: snapcraft login
#   - .deb already built: yarn make (on Linux, from apps/electron)
#
# Examples:
#   ./scripts/publish-snap.sh
#   ./scripts/publish-snap.sh beta
#   ./scripts/publish-snap.sh stable
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"

# Read version from package.json
VERSION=$(node -p "require('$ELECTRON_DIR/package.json').version")
echo "Version: $VERSION"

# Auto-detect channel
if [ -n "$1" ]; then
  CHANNEL="$1"
elif [[ "$VERSION" == *"beta"* ]] || [[ "$VERSION" == *"alpha"* ]] || [[ "$VERSION" == *"rc"* ]]; then
  CHANNEL="beta"
else
  CHANNEL="stable"
fi

# grade must be "stable" for stable/candidate channels, "devel" is fine for beta/edge
# but "stable" grade works for all channels, so we keep it stable always
GRADE="stable"

echo "Channel: $CHANNEL"
echo "Grade:   $GRADE"

# Ensure .deb exists
DEB_PATH=$(find "$ELECTRON_DIR/out/make/deb/x64" -name "*.deb" 2>/dev/null | head -1)
if [ -z "$DEB_PATH" ]; then
  echo ""
  echo "ERROR: No .deb found in out/make/deb/x64/"
  echo "Run 'yarn make' first from apps/electron"
  exit 1
fi

echo "Found .deb: $DEB_PATH"

# Generate snapcraft.yaml into a temp build dir
BUILD_DIR=$(mktemp -d)
echo ""
echo "Generating snapcraft.yaml in $BUILD_DIR..."

cat > "$BUILD_DIR/snapcraft.yaml" <<EOF
name: voiden
title: Voiden
summary: API development tool
description: |
  Build, Test, Document & Collaborate.
  Streamline your API development process with Voiden.
version: "$VERSION"
license: Apache-2.0
contact: info@voiden.md
website: https://voiden.md
issues: https://github.com/VoidenHQ/voiden/issues

base: core22
confinement: classic
grade: $GRADE

architectures:
  - build-on: amd64

apps:
  voiden:
    command: usr/lib/voiden/voiden
    desktop: usr/share/applications/voiden.desktop
    environment:
      DISABLE_GPU_SANDBOX: "1"

parts:
  voiden-deb:
    plugin: dump
    source: $DEB_PATH
    source-type: deb
    stage-packages:
      - libgtk-3-0
      - libnotify4
      - libnss3
      - libxss1
      - libxtst6
      - xdg-utils
      - libatspi2.0-0
      - libuuid1
      - libsecret-1-0
EOF

echo "Generated snapcraft.yaml:"
echo ""
cat "$BUILD_DIR/snapcraft.yaml"
echo ""

# Build the snap from the temp dir
echo "Building snap..."
cd "$BUILD_DIR"
snapcraft

# Find the built .snap
SNAP_PATH=$(find "$BUILD_DIR" -maxdepth 1 -name "*.snap" | head -1)
if [ -z "$SNAP_PATH" ]; then
  echo "ERROR: No .snap file found after build"
  exit 1
fi

# Calculate SHA256
SHA256=$(shasum -a 256 "$SNAP_PATH" | awk '{print $1}')

echo ""
echo "=========================================="
echo " Snap built successfully"
echo "=========================================="
echo ""
echo "  File:    $SNAP_PATH"
echo "  Version: $VERSION"
echo "  Channel: $CHANNEL"
echo "  SHA256:  $SHA256"
echo "  Arch:    amd64 (x86_64)"
echo ""
echo "=========================================="
echo " Next steps"
echo "=========================================="
echo ""
echo "  1. Login to Snap Store (if not already):"
echo "     snapcraft login"
echo ""
echo "  2. Upload and release:"
echo "     snapcraft upload --release=$CHANNEL $SNAP_PATH"
echo ""
echo "  3. Verify on the Snap Store:"
echo "     https://snapcraft.io/voiden"
echo ""
echo "  Users install with:"
echo "     snap install voiden --channel=$CHANNEL"
echo ""
