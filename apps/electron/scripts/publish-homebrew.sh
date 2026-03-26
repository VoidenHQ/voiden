#!/bin/bash
# =============================================================================
# publish-homebrew.sh
#
# Generates SHA256 hashes for macOS zip artifacts (arm64 + x64) and outputs
# the updated Homebrew cask content, with steps to submit a PR.
#
# Stable releases  → homebrew-cask        (Casks/v/voiden.rb)
# Beta releases    → homebrew-cask-versions (Casks/v/voiden-beta.rb)
#
# Usage:
#   ./scripts/publish-homebrew.sh [arm64-zip] [x64-zip]
#
# Arguments:
#   arm64-zip   Path to the arm64 .zip (optional, looks in out/make/ if not provided)
#   x64-zip     Path to the x64 .zip   (optional, looks in out/make/ if not provided)
#
# Prerequisites:
#   - macOS zips already built: yarn make (on macOS)
#   - Fork of the target Homebrew repo cloned locally (done once):
#       Stable: git clone https://github.com/<you>/homebrew-cask ~/homebrew/homebrew-cask
#       Beta:   git clone https://github.com/<you>/homebrew-cask-versions ~/homebrew/homebrew-cask-versions
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"

# Read version from package.json
VERSION=$(node -p "require('$ELECTRON_DIR/package.json').version")
echo "Version: $VERSION"

# Detect stable vs beta
if [[ "$VERSION" == *"beta"* ]] || [[ "$VERSION" == *"alpha"* ]] || [[ "$VERSION" == *"rc"* ]]; then
  CHANNEL="beta"
  CASK_NAME="voiden-beta"
  HOMEBREW_REPO="homebrew-cask-versions"
  CASK_PATH="Casks/v/voiden-beta.rb"
else
  CHANNEL="stable"
  CASK_NAME="voiden"
  HOMEBREW_REPO="homebrew-cask"
  CASK_PATH="Casks/v/voiden.rb"
fi

echo "Channel:  $CHANNEL"
echo "Cask:     $CASK_NAME"
echo "Repo:     Homebrew/$HOMEBREW_REPO"

# Find zip artifacts
if [ -n "$1" ]; then
  ARM64_ZIP="$1"
else
  ARM64_ZIP=$(find "$ELECTRON_DIR/out/make" -name "*arm64*.zip" 2>/dev/null | head -1)
fi

if [ -n "$2" ]; then
  X64_ZIP="$2"
else
  X64_ZIP=$(find "$ELECTRON_DIR/out/make" -name "*x64*.zip" 2>/dev/null | head -1)
fi

if [ -z "$ARM64_ZIP" ] || [ ! -f "$ARM64_ZIP" ]; then
  echo ""
  echo "ERROR: Could not find arm64 .zip in out/make/"
  echo "Build first with 'yarn make' on macOS or pass the path:"
  echo "  ./scripts/publish-homebrew.sh /path/to/arm64.zip /path/to/x64.zip"
  exit 1
fi

if [ -z "$X64_ZIP" ] || [ ! -f "$X64_ZIP" ]; then
  echo ""
  echo "ERROR: Could not find x64 .zip in out/make/"
  echo "Build first with 'yarn make' on macOS or pass the path:"
  echo "  ./scripts/publish-homebrew.sh /path/to/arm64.zip /path/to/x64.zip"
  exit 1
fi

echo ""
echo "Calculating SHA256..."
SHA256_ARM64=$(shasum -a 256 "$ARM64_ZIP" | awk '{print $1}')
SHA256_X64=$(shasum -a 256 "$X64_ZIP" | awk '{print $1}')

echo "  arm64: $SHA256_ARM64"
echo "  x64:   $SHA256_X64"

# Generate cask content
if [ "$CHANNEL" = "beta" ]; then
CASK_CONTENT=$(cat <<EOF
cask "$CASK_NAME" do
  arch arm: "arm64", intel: "x64"

  version "$VERSION"
  sha256 arm:   "$SHA256_ARM64",
         intel: "$SHA256_X64"

  url "https://voiden-beta-releases.s3.eu-west-1.amazonaws.com/voiden/darwin/\#{arch}/Voiden-darwin-\#{arch}-\#{version}.zip",
      verified: "voiden-beta-releases.s3.eu-west-1.amazonaws.com/"
  name "Voiden Beta"
  desc "API development tool (beta)"
  homepage "https://voiden.md/"

  livecheck do
    url "https://voiden-beta-releases.s3.eu-west-1.amazonaws.com/voiden/darwin/\#{arch}/RELEASES.json"
    strategy :json do |json|
      json["currentRelease"]
    end
  end

  conflicts_with cask: "voiden"

  app "Voiden.app"

  zap trash: [
    "~/Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments/com.electron.voiden.sfl*",
    "~/Library/Application Support/Voiden",
    "~/Library/Caches/com.electron.voiden",
    "~/Library/Caches/com.electron.voiden.ShipIt",
    "~/Library/HTTPStorages/com.electron.voiden",
    "~/Library/Preferences/com.electron.voiden.plist",
  ]
end
EOF
)
else
CASK_CONTENT=$(cat <<EOF
cask "$CASK_NAME" do
  arch arm: "arm64", intel: "x64"

  version "$VERSION"
  sha256 arm:   "$SHA256_ARM64",
         intel: "$SHA256_X64"

  url "https://voiden-releases.s3.eu-west-1.amazonaws.com/voiden/darwin/\#{arch}/Voiden-darwin-\#{arch}-\#{version}.zip",
      verified: "voiden-releases.s3.eu-west-1.amazonaws.com/"
  name "Voiden"
  desc "API development tool"
  homepage "https://voiden.md/"

  livecheck do
    url "https://voiden-releases.s3.eu-west-1.amazonaws.com/voiden/darwin/\#{arch}/RELEASES.json"
    strategy :json do |json|
      json["currentRelease"]
    end
  end

  app "Voiden.app"

  zap trash: [
    "~/Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments/com.electron.voiden.sfl*",
    "~/Library/Application Support/Voiden",
    "~/Library/Caches/com.electron.voiden",
    "~/Library/Caches/com.electron.voiden.ShipIt",
    "~/Library/HTTPStorages/com.electron.voiden",
    "~/Library/Preferences/com.electron.voiden.plist",
  ]
end
EOF
)
fi

# Print cask
echo ""
echo "=========================================="
echo " Generated cask: $CASK_PATH"
echo "=========================================="
echo ""
echo "$CASK_CONTENT"
echo ""
echo "=========================================="
echo " Next steps"
echo "=========================================="
echo ""
echo "  1. Go to your local fork of Homebrew/$HOMEBREW_REPO:"
echo "     cd ~/homebrew/$HOMEBREW_REPO"
echo ""
echo "  2. Pull latest upstream changes:"
echo "     git remote add upstream https://github.com/Homebrew/$HOMEBREW_REPO 2>/dev/null || true"
echo "     git checkout master && git pull upstream master"
echo ""
echo "  3. Create a branch:"
echo "     git checkout -b update-$CASK_NAME-$VERSION"
echo ""
echo "  4. Replace the cask file with the content above:"
echo "     The file is at: $CASK_PATH"
echo ""
echo "  5. Commit and push:"
echo "     git add $CASK_PATH"
echo "     git commit -m \"Update $CASK_NAME to $VERSION\""
echo "     git push origin update-$CASK_NAME-$VERSION"
echo ""
echo "  6. Open a PR at:"
echo "     https://github.com/Homebrew/$HOMEBREW_REPO/compare"
echo ""
