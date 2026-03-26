#!/bin/bash
# =============================================================================
# publish-aur.sh
#
# Updates and pushes the Voiden AUR packages (voiden-appimage / voiden-beta-appimage).
# Automatically detects stable vs beta from the version in package.json.
#
# Usage:
#   ./scripts/publish-aur.sh [appimage-path]
#
# Arguments:
#   appimage-path   Path to the built .AppImage (optional).
#                   If not provided, script looks in out/make/
#
# Prerequisites:
#   - SSH key registered on AUR: https://aur.archlinux.org/account
#   - AUR repos cloned locally (done once — see FIRST TIME SETUP below)
#   - AppImage already built: yarn make (on Linux)
#
# FIRST TIME SETUP (run once):
#   git clone ssh://aur@aur.archlinux.org/voiden-appimage.git ~/aur/voiden-appimage
#   git clone ssh://aur@aur.archlinux.org/voiden-beta-appimage.git ~/aur/voiden-beta-appimage
#
# The script will look for the cloned repos in ~/aur/ by default.
# Override with AUR_DIR env var:
#   AUR_DIR=/path/to/aur ./scripts/publish-aur.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
AUR_DIR="${AUR_DIR:-$HOME/aur}"

# Read version from package.json
VERSION=$(node -p "require('$ELECTRON_DIR/package.json').version")
echo "Version: $VERSION"

# Detect stable vs beta
if [[ "$VERSION" == *"beta"* ]] || [[ "$VERSION" == *"alpha"* ]] || [[ "$VERSION" == *"rc"* ]]; then
  CHANNEL="beta"
  # AUR pkgver cannot have hyphens — split "1.4.2-beta.1" into "1.4.2" and "-beta.1"
  PKG_VER="${VERSION%%-*}"           # e.g. 1.4.2
  BETA_TAG="-${VERSION#*-}"         # e.g. -beta.1
  PKG_NAME="voiden-beta-appimage"
  PKG_DESC="Voiden Beta API Client"
  APPIMAGE_NAME="Voiden-${PKG_VER}${BETA_TAG}.AppImage"
  DOWNLOAD_URL="https://voiden.md/api/download/beta/linux/x64/${APPIMAGE_NAME}"
  CONFLICTS="conflicts=('voiden-appimage')"
  CONFLICTS_SRCINFO="	conflicts = voiden-appimage"
else
  CHANNEL="stable"
  PKG_VER="$VERSION"
  BETA_TAG=""
  PKG_NAME="voiden-appimage"
  PKG_DESC="Voiden API Client"
  APPIMAGE_NAME="Voiden-${PKG_VER}.AppImage"
  DOWNLOAD_URL="https://voiden.md/api/download/stable/linux/x64/${APPIMAGE_NAME}"
  CONFLICTS=""
  CONFLICTS_SRCINFO=""
fi

echo "Channel:  $CHANNEL"
echo "Package:  $PKG_NAME"
echo "AppImage: $APPIMAGE_NAME"

# Find AppImage
if [ -n "$1" ]; then
  APPIMAGE_PATH="$1"
else
  APPIMAGE_PATH=$(find "$ELECTRON_DIR/out/make" -name "*.AppImage" 2>/dev/null | head -1)
fi

if [ -z "$APPIMAGE_PATH" ] || [ ! -f "$APPIMAGE_PATH" ]; then
  echo ""
  echo "ERROR: Could not find .AppImage"
  echo "Either build it first with 'yarn make' on Linux or pass the path as an argument:"
  echo "  ./scripts/publish-aur.sh /path/to/Voiden.AppImage"
  exit 1
fi

echo "AppImage: $APPIMAGE_PATH"

# Calculate SHA256
echo "Calculating SHA256..."
SHA256=$(shasum -a 256 "$APPIMAGE_PATH" | awk '{print $1}')
echo "SHA256: $SHA256"

# Check AUR repo exists
AUR_REPO_DIR="$AUR_DIR/$PKG_NAME"
if [ ! -d "$AUR_REPO_DIR/.git" ]; then
  echo ""
  echo "ERROR: AUR repo not found at $AUR_REPO_DIR"
  echo ""
  echo "First time setup — clone the AUR repo once:"
  echo "  mkdir -p $AUR_DIR"
  echo "  git clone ssh://aur@aur.archlinux.org/${PKG_NAME}.git $AUR_REPO_DIR"
  exit 1
fi

echo ""
echo "Updating $AUR_REPO_DIR..."

# Write PKGBUILD
if [ "$CHANNEL" = "beta" ]; then
cat > "$AUR_REPO_DIR/PKGBUILD" <<EOF
# Maintainer: Mike Simpson <voiden.t2tan@aleeas.com>
_pkgname=voiden

pkgname=\${_pkgname}-beta-appimage
pkgver=$PKG_VER
_beta_tag=$BETA_TAG
pkgrel=1
pkgdesc="$PKG_DESC"
arch=('x86_64')
url="https://voiden.md"
license=('Apache-2.0')
options=('!strip' '!debug')
conflicts=('voiden-appimage')
_appimage=Voiden-\${pkgver}\${_beta_tag}.AppImage
source=("https://voiden.md/api/download/beta/linux/x64/\${_appimage}")
sha256sums=('$SHA256')

prepare() {
  chmod +x "\${_appimage}"
  ./"\${_appimage}" --appimage-extract
}

build() {
  sed -i -E "s|Exec=Voiden.*|Exec=/usr/bin/\${pkgname}|" \\
    "\${srcdir}/squashfs-root/Voiden.desktop"
}

package() {
  install -Dm755 "\${srcdir}/\${_appimage}" "\${pkgdir}/opt/\${pkgname}/\${_appimage}"
  install -Dm644 "\${srcdir}/squashfs-root/LICENSE" "\${pkgdir}/opt/\${pkgname}/LICENSE"
  install -Dm644 "\${srcdir}/squashfs-root/Voiden.desktop" \\
    "\${pkgdir}/usr/share/applications/Voiden.desktop"
  install -Dm644 "\${srcdir}/squashfs-root/resources/logo-dark.png" "\${pkgdir}/usr/share/pixmaps/Voiden.png"
  install -dm755 "\${pkgdir}/usr/bin"
  ln -s "/opt/\${pkgname}/\${_appimage}" "\${pkgdir}/usr/bin/\${pkgname}"
  install -dm755 "\${pkgdir}/usr/share/licenses/\${pkgname}/"
  ln -s "/opt/\${pkgname}/LICENSE" "\${pkgdir}/usr/share/licenses/\${pkgname}"
}
EOF
else
cat > "$AUR_REPO_DIR/PKGBUILD" <<EOF
# Maintainer: Mike Simpson <voiden.t2tan@aleeas.com>
_pkgname=voiden

pkgname=\${_pkgname}-appimage
pkgver=$PKG_VER
pkgrel=1
pkgdesc="$PKG_DESC"
arch=('x86_64')
url="https://voiden.md"
license=('Apache-2.0')
options=('!strip' '!debug')
_appimage=Voiden-\${pkgver}.AppImage
source=("https://voiden.md/api/download/stable/linux/x64/\${_appimage}")
sha256sums=('$SHA256')

prepare() {
  chmod +x "\${_appimage}"
  ./"\${_appimage}" --appimage-extract
}

build() {
  sed -i -E "s|Exec=Voiden.*|Exec=/usr/bin/\${pkgname}|" \\
    "\${srcdir}/squashfs-root/Voiden.desktop"
}

package() {
  install -Dm755 "\${srcdir}/\${_appimage}" "\${pkgdir}/opt/\${pkgname}/\${_appimage}"
  install -Dm644 "\${srcdir}/squashfs-root/LICENSE" "\${pkgdir}/opt/\${pkgname}/LICENSE"
  install -Dm644 "\${srcdir}/squashfs-root/Voiden.desktop" \\
    "\${pkgdir}/usr/share/applications/Voiden.desktop"
  install -Dm644 "\${srcdir}/squashfs-root/resources/logo-dark.png" "\${pkgdir}/usr/share/pixmaps/Voiden.png"
  install -dm755 "\${pkgdir}/usr/bin"
  ln -s "/opt/\${pkgname}/\${_appimage}" "\${pkgdir}/usr/bin/\${pkgname}"
  install -dm755 "\${pkgdir}/usr/share/licenses/\${pkgname}/"
  ln -s "/opt/\${pkgname}/LICENSE" "\${pkgdir}/usr/share/licenses/\${pkgname}"
}
EOF
fi

# Write .SRCINFO
cat > "$AUR_REPO_DIR/.SRCINFO" <<EOF
pkgbase = $PKG_NAME
	pkgdesc = $PKG_DESC
	pkgver = $PKG_VER
	pkgrel = 1
	url = https://voiden.md
	arch = x86_64
	license = Apache-2.0
$([ -n "$CONFLICTS_SRCINFO" ] && echo "$CONFLICTS_SRCINFO")	options = !strip
	options = !debug
	source = $DOWNLOAD_URL
	sha256sums = $SHA256

pkgname = $PKG_NAME
EOF

echo "PKGBUILD and .SRCINFO updated."

# Commit and push
cd "$AUR_REPO_DIR"
git add PKGBUILD .SRCINFO
git commit -m "Update to $VERSION"
git push origin master

echo ""
echo "=========================================="
echo " AUR package updated: $PKG_NAME $VERSION"
echo " https://aur.archlinux.org/packages/$PKG_NAME"
echo "=========================================="
