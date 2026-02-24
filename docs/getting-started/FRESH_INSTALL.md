# Getting Started - Fresh Install

Complete setup guide for a fresh clone of the Voiden repository.

## Prerequisites

- **Node.js** v21.x ([Download](https://nodejs.org/))
- **Git** (for cloning the repository)
- Corepack (comes with Node.js, but must be enabled manually)
- **Yarn** v4.3.1 (installed automatically, see below)

  #### Setup Instructions
  After installing Node.js
  ```bash
  corepack enable
  yarn set version 4.3.1
  ```

## Quick Start

```bash
# 1. Clone the repository
git clone <repository-url>
cd voiden

# 2. Set Yarn version
yarn set version 4.3.1

# 3. Install all dependencies
yarn install

# 4. Build core-extensions
yarn workspace @voiden/core-extensions build

# 5. Navigate to electron main folder
cd apps/electron

# 6. Start the app
yarn start
```

## Clean Rebuild (Recommended for Issues)

If you encounter dependency issues, stale caches, or want a completely fresh start, use the cleanup script:

```bash
# For Mac & linux devices
./cleanup.sh

# For Window 
./cleanup.bat
```

**What this script does:**
1. Removes all `node_modules` folders
2. Removes all `dist` folders (compiled output)
3. Clears TypeScript build cache (`.tsbuildinfo`)
4. Clears Vite cache
5. Removes build artifacts (`apps/electron/out`, etc.)
6. Runs `yarn install`
7. Builds core-extensions (includes `generate-registry`)

After running, simply start the app:
```bash
cd apps/electron
yarn start
```

## Detailed Steps

### Step 1: Clone Repository

```bash
git clone <repository-url>
cd voiden
```

### Step 2: Set Yarn Version

The project uses Yarn v4.3.1 (Berry):

```bash
yarn set version 4.3.1
```

This creates a `.yarnrc.yml` file and downloads Yarn to `.yarn/releases/`.

### Step 3: Install Dependencies

From the root directory:

```bash
yarn install
```

This installs dependencies for all workspaces:
- Root project
- `apps/electron`
- `apps/ui`
- `packages/sdk`
- `packages/core-extensions`
- `packages/shared`

**Note:** This may take a few minutes on first install.

### Step 4: Build Core-Extensions

```bash
# Core extensions (auto-generates registry)
yarn workspace @voiden/core-extensions build
```

**What happens during build:**
- `@voiden/core-extensions`:
  - Runs `generate-registry` (finds extensions via manifest.json)
  - Compiles TypeScript
  - Creates `dist/` with compiled extensions

### Step 5: Build UI

The UI app uses Vite and doesn't need TypeScript pre-compilation:

```bash
cd apps/ui
yarn build
```

This creates an optimized production build in `apps/ui/dist/`.

**Note:** You can skip this step if you're only running in dev mode (`yarn start` will build on-the-fly).

### Step 6: Start the App

```bash
cd apps/electron
yarn start
```

This launches the Electron app in development mode with:
- Hot reload enabled
- DevTools available
- Source maps for debugging

## Development Workflow

### Running in Dev Mode

For active development with hot reload:

```bash

# Terminal 1: Watch core-extensions (optional)
cd core-extensions
yarn dev

# Terminal 2: Start electron (this runs UI in dev mode too)
cd apps/electron
yarn start
```

The UI automatically rebuilds when you save files.

### Making Changes

#### UI Changes (apps/ui)
- Changes auto-reload via Vite HMR
- No rebuild needed
- Just save and see changes

#### Extension Changes (packages/core-extensions)
1. Make your changes
2. Rebuild: `yarn workspace @voiden/core-extensions build`
3. Clear Vite cache: `rm -rf apps/ui/node_modules/.vite`
4. Restart electron: `yarn start`

## Common Issues

### Issue: `command not found: vite`

**Solution:**
```bash
cd apps/ui
yarn install
yarn build
```

### Issue: `Cannot find module '@voiden/core-extensions'`

**Solution:**
```bash
# Build the package
yarn workspace @voiden/core-extensions build

# Verify dist exists
ls packages/core-extensions/dist/
```

### Issue: `Module not found` errors after pulling changes

**Solution:** Run the cleanup script for a full clean rebuild:
```bash
./cleanup.sh
```

Or manually:
```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
yarn install
yarn workspace @voiden/core-extensions build
```

### Issue: Changes not reflecting in app

**Solution:**
```bash
# Clear Vite cache
rm -rf apps/ui/node_modules/.vite
rm -rf apps/electron/node_modules/.vite

# Restart app completely (don't just reload)
cd apps/electron
yarn start
```

### Issue: TypeScript errors in IDE

**Solution:**
```bash
# Ensure core-extensions are built
yarn workspace @voiden/core-extensions build

# Restart TypeScript server in your IDE
# VSCode: Cmd+Shift+P → "TypeScript: Restart TS Server"
```

## Verifying Installation

After setup, verify everything works:

### 1. Check App Launches
```bash
cd apps/electron
yarn start
```

App should open without errors.

### 2. Check Console for Extension Loading
Look for these logs in DevTools (Cmd+Option+I):
```
[PLUGINS] Loading core extension: hello-world
[PLUGINS] Loading core extension: md-preview
🟢 [HELLO-WORLD] Loading...
🟢 [MD-PREVIEW] Loading...
```

### 3. Test Basic Functionality
- Create a new `.void` file
- Try slash commands (`/hello`, `/goodbye`)
- Create a `.md` file and toggle preview
- Send an HTTP request (if voiden-api is enabled)

## Next Steps

- **Architecture Overview**: See `docs/architecture/OVERVIEW.md`
- **Extension Development**: See `docs/extensions/HOW_TO_ADD.md`
- **Contributing**: See `docs/contributing/GUIDELINES.md`

## Quick Reference

### Workspace Commands

```bash
# List all workspaces
yarn workspaces list

# Build a core-extension workspace
yarn workspace @voiden/core-extensions build

# Run command in workspace
yarn workspace apps/ui <command>
```

### Build Order (Important!)

Always build in this order:
1. `@voiden/core-extensions` (depends on SDK)
2. `apps/ui` (optional for dev, needed for production)

### File Locations

- **App Data**: `~/Library/Application Support/Voiden/` (macOS)
- **Extensions**: `~/Library/Application Support/Voiden/extensions/`
- **State**: `~/Library/Application Support/Voiden/voiden-state.json`
<!-- - **Logs**: Check Electron console (Cmd+Option+I) -->

## Production Build

To create a distributable app:

```bash
# Build everything
yarn workspace @voiden/core-extensions build
cd apps/ui && yarn build

# Create distributable
cd ../electron
yarn make
```

Distributables are created in `apps/electron/out/make/`.

## Getting Help

- Check `docs/troubleshooting/COMMON_ISSUES.md`
- Review architecture docs in `docs/architecture/`
- Check existing issues on GitHub
- Ask in developer chat/forum
