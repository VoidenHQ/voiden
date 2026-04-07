#!/bin/bash

# Voiden Cleanup Script
# This script removes all node_modules, dist, and cache folders, then performs a clean install and build
#
# What this script does:
# 1. Removes all node_modules folders
# 2. Removes all dist folders (compiled output)
# 3. Clears TypeScript build cache
# 4. Clears Vite cache
# 5. Removes build artifacts
# 6. Clears Yarn cache (optional)
# 7. Runs yarn install (fetches @voiden/core-extensions from GitHub Releases)

set -e  # Exit on error

echo "🧹 Starting Voiden cleanup..."
echo ""

# Store the root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Remove all node_modules folders
echo -e "${YELLOW}=📦 Removing all node_modules folders...${NC}"
find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
echo -e "${GREEN}✓ Removed all node_modules${NC}"
echo ""

# Step 2: Remove all dist folders
echo -e "${YELLOW}=📦 Removing all dist folders...${NC}"
find . -name "dist" -type d -prune -exec rm -rf '{}' +
echo -e "${GREEN}✓ Removed all dist folders${NC}"
echo ""

# Step 3: Remove TypeScript build info files
echo -e "${YELLOW}=🗑️  Removing TypeScript build cache...${NC}"
find . -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true
echo -e "${GREEN}✓ Removed TypeScript build cache${NC}"
echo ""

# Step 4: Remove Vite cache
echo -e "${YELLOW}=🗑️  Removing Vite cache...${NC}"
rm -rf apps/ui/node_modules/.vite 2>/dev/null || true
echo -e "${GREEN}✓ Removed Vite cache${NC}"
echo ""

# Step 5: Remove build artifacts
echo -e "${YELLOW}=🗑️  Removing build artifacts...${NC}"
rm -rf apps/electron/out 2>/dev/null || true
rm -rf apps/ui/.vite 2>/dev/null || true
echo -e "${GREEN}✓ Removed build artifacts${NC}"
echo ""

# Step 6: Clear Yarn cache (optional - uncomment if needed)
# echo -e "${YELLOW}=🗑️  Clearing Yarn cache...${NC}"
# yarn cache clean --all
# echo -e "${GREEN}✓ Cleared Yarn cache${NC}"
# echo ""

# Step 7: Clean install
echo -e "${YELLOW}=📦 Running yarn install...${NC}"
yarn install
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 8: Optional - Build UI (commented out by default since dev mode doesn't need it)
# Uncomment the lines below if you want to build the UI as well
# echo "  4/4 Building UI..."
# cd apps/ui && yarn build
# cd "$ROOT_DIR"
# echo -e "${GREEN}   ✓ UI built${NC}"
# echo ""

echo -e "${GREEN}🎉 Cleanup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. To start the app: cd apps/electron && yarn start"
echo "  2. To build UI (optional): cd apps/ui && yarn build"
echo ""
