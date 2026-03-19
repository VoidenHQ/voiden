#!/bin/bash

# Download all fonts for Voiden
# Run this script from the project root

set -e

echo "🔤 Downloading fonts for Voiden..."
echo ""

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_FONTS="$SCRIPT_DIR/../../../electron/public/fonts"

# Create directories
mkdir -p "$SCRIPT_DIR"
mkdir -p "$ELECTRON_FONTS"

cd "$SCRIPT_DIR"

# Geist
echo "📥 Downloading Geist..."
curl -L -o geist-variable.woff2 "https://raw.githubusercontent.com/vercel/geist-font/main/fonts/Geist/webfonts/Geist%5Bwght%5D.woff2"
echo "✅ Geist downloaded"

# Geist Mono
echo "📥 Downloading Geist Mono..."
curl -L -o geist-mono-variable.woff2 "https://github.com/vercel/geist-font/raw/main/packages/next/dist/fonts/geist-mono/GeistMono-Variable.woff2"
echo "✅ Geist Mono downloaded"

# Inconsolata
echo "📥 Downloading Inconsolata..."
curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://fonts.googleapis.com/css2?family=Inconsolata:wght@200..900&display=swap" \
  | grep -o "https://[^)]*\.woff2" | head -1 | xargs curl -s -o inconsolata-variable.woff2
echo "✅ Inconsolata downloaded"

# JetBrains Mono
echo "📥 Downloading JetBrains Mono..."
curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@100..800&display=swap" \
  | grep -o "https://[^)]*\.woff2" | head -1 | xargs curl -s -o jetbrains-mono-variable.woff2
echo "✅ JetBrains Mono downloaded"

# Fira Code
echo "📥 Downloading Fira Code..."
curl -s -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://fonts.googleapis.com/css2?family=Fira+Code:wght@300..700&display=swap" \
  | grep -o "https://[^)]*\.woff2" | head -1 | xargs curl -s -o fira-code-variable.woff2
echo "✅ Fira Code downloaded"

# Copy to Electron directory
echo ""
echo "📋 Copying fonts to Electron directory..."
cp *.woff2 "$ELECTRON_FONTS/"

echo ""
echo "🎉 All fonts downloaded successfully!"
echo ""
echo "📊 Font files in apps/ui/public/fonts:"
ls -lh *.woff2 2>/dev/null || echo "No font files found"
echo ""
echo "📊 Font files in apps/electron/public/fonts:"
ls -lh "$ELECTRON_FONTS"/*.woff2 2>/dev/null || echo "No font files found"
