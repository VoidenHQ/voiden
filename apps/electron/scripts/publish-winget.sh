#!/bin/bash
# =============================================================================
# publish-winget.sh
#
# Generates WinGet manifests for Voiden and prints steps to submit them.
# Nothing is committed to this repo — files are written to a temp directory.
#
# Usage:
#   ./scripts/publish-winget.sh [installer-path]
#
# Arguments:
#   installer-path   Path to the .exe installer (optional).
#                    If not provided, script looks in out/make/
#
# Prerequisites:
#   - Windows .exe already built (yarn make on Windows)
#   - shasum available (macOS built-in)
#
# NOTE: WinGet only accepts stable releases. Do not run this for beta versions.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"

# Read version from package.json
VERSION=$(node -p "require('$ELECTRON_DIR/package.json').version")
echo "Version: $VERSION"

# Block beta releases
if [[ "$VERSION" == *"beta"* ]] || [[ "$VERSION" == *"alpha"* ]] || [[ "$VERSION" == *"rc"* ]]; then
  echo ""
  echo "ERROR: WinGet does not support pre-release versions."
  echo "Current version is '$VERSION' — only run this for stable releases."
  exit 1
fi

# Find installer
if [ -n "$1" ]; then
  INSTALLER_PATH="$1"
else
  INSTALLER_PATH=$(find "$ELECTRON_DIR/out/make" -name "*Setup.exe" 2>/dev/null | head -1)
fi

if [ -z "$INSTALLER_PATH" ] || [ ! -f "$INSTALLER_PATH" ]; then
  echo ""
  echo "ERROR: Could not find installer .exe"
  echo "Either build it first with 'yarn make' or pass the path as an argument:"
  echo "  ./scripts/publish-winget.sh /path/to/Voiden-Setup.exe"
  exit 1
fi

echo "Installer: $INSTALLER_PATH"

# Calculate SHA256
echo "Calculating SHA256..."
SHA256=$(shasum -a 256 "$INSTALLER_PATH" | awk '{print $1}' | tr '[:lower:]' '[:upper:]')
echo "SHA256: $SHA256"

# Installer URL on S3
INSTALLER_URL="https://voiden-releases.s3.eu-west-1.amazonaws.com/voiden/win32/x64/Voiden-win32-x64-${VERSION}-Setup.exe"

# Output directory
OUT_DIR="$ELECTRON_DIR/out/winget/$VERSION"
mkdir -p "$OUT_DIR"

# --- Voiden.Voiden.yaml ---
cat > "$OUT_DIR/Voiden.Voiden.yaml" <<EOF
PackageIdentifier: Voiden.Voiden
PackageVersion: $VERSION
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
EOF

# --- Voiden.Voiden.installer.yaml ---
cat > "$OUT_DIR/Voiden.Voiden.installer.yaml" <<EOF
PackageIdentifier: Voiden.Voiden
PackageVersion: $VERSION
InstallerLocale: en-US
InstallerType: nullsoft
UpgradeBehavior: install
Installers:
  - Architecture: x64
    InstallerUrl: $INSTALLER_URL
    InstallerSha256: $SHA256
ManifestType: installer
ManifestVersion: 1.6.0
EOF

# --- Voiden.Voiden.locale.en-US.yaml ---
cat > "$OUT_DIR/Voiden.Voiden.locale.en-US.yaml" <<EOF
PackageIdentifier: Voiden.Voiden
PackageVersion: $VERSION
PackageLocale: en-US
Publisher: Voiden by ApyHub
PublisherUrl: https://voiden.md
PublisherSupportUrl: https://github.com/VoidenHQ/voiden/issues
Author: Voiden by ApyHub
PackageName: Voiden
PackageUrl: https://voiden.md
License: Apache-2.0
LicenseUrl: https://github.com/VoidenHQ/voiden/blob/main/LICENSE
Copyright: Copyright (c) Voiden by ApyHub
ShortDescription: API development tool
Description: Build, Test, Document & Collaborate. Streamline your API development process with Voiden.
Moniker: voiden
Tags:
  - api
  - rest
  - graphql
  - http
  - developer-tools
ManifestType: defaultLocale
ManifestVersion: 1.6.0
EOF

echo ""
echo "=========================================="
echo " Manifests generated at:"
echo " $OUT_DIR"
echo "=========================================="
echo ""
echo "Next steps to submit to WinGet:"
echo ""
echo "  1. Go to your winget-pkgs fork (fork once at https://github.com/microsoft/winget-pkgs)"
echo "     and pull latest changes:"
echo "     cd ~/path/to/winget-pkgs"
echo "     git checkout master && git pull upstream master"
echo ""
echo "  2. Create a branch:"
echo "     git checkout -b voiden-$VERSION"
echo ""
echo "  3. Copy the generated manifests:"
echo "     mkdir -p manifests/v/Voiden/Voiden/$VERSION"
echo "     cp $OUT_DIR/*.yaml manifests/v/Voiden/Voiden/$VERSION/"
echo ""
echo "  4. Commit and push:"
echo "     git add manifests/v/Voiden/Voiden/$VERSION"
echo "     git commit -m 'Add Voiden $VERSION'"
echo "     git push origin voiden-$VERSION"
echo ""
echo "  5. Open PR at https://github.com/microsoft/winget-pkgs/compare"
echo "     against the master branch"
echo ""
