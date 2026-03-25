import { BrowserWindow, app, dialog } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { windowManager } from "./windowManager";
import { activateTab, addPanelTab } from "./state";




export async function handleCliArguments(
  args: string[]
) {

  // Filter out Electron/Chromium/NSIS installer arguments
  const userArgs = args.filter(arg =>
    !arg.includes('electron') &&
    !arg.endsWith('.js') &&
    !arg.startsWith('--updated') &&
    !arg.startsWith('--force-run') &&
    !arg.startsWith('--squirrel') &&
    arg !== ''
  );


  const firstArg = userArgs[0];

  // No arguments (e.g. launched by NSIS after update) — open a clean window
  if (userArgs.length === 0) {
    const main = await windowManager.createWindow(undefined, true);
    main.webContents.on('did-finish-load', () => {
      main.focus();
    });
    return;
  }

  // Explicit "." — open current terminal working directory
  if (firstArg === '.') {
    await openPath(await resolveToAbsolutePath('.'));
    return;
  }

  // Process all arguments as paths (supports multiple files)
  for (const arg of userArgs) {
    await openPath(arg);
  }


}
/**
 * Resolve path to absolute path
 * - If absolute path: use as-is
 * - If relative path: resolve from current working directory (terminal location)
 * 
 * @param inputPath - The path to resolve
 * @param cwd - Current working directory (optional, defaults to process.cwd())
 * @returns Resolved absolute path
 */
async function resolveToAbsolutePath(
  inputPath: string,
  cwd?: string
): Promise<string> {
  // If it's already an absolute path, use it as-is
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  // Resolve relative path from current working directory
  const workingDir = cwd || process.cwd();
  const resolvedPath = path.resolve(workingDir, inputPath);

  return resolvedPath;
}

// Open a path (file or directory)
async function openPath(inputPath: string): Promise<void> {
  const resolvedPath = await resolveToAbsolutePath(inputPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    console.warn('[CLI] Could not resolve path:', inputPath);
    // If a window already exists, just focus it
    const mainWindow = windowManager.browserWindow as BrowserWindow;
    if (mainWindow) {
      mainWindow.focus();
    }
    // Otherwise skip silently — loadAllWindows() will handle normal restoration
    return;
  }

  try {
    const stats = await fs.promises.stat(resolvedPath);
    if (stats.isDirectory()) {
      if (windowManager.focusWindowByProject(resolvedPath)) {
        return;
      }
      if (isSystemFolder(resolvedPath)) {
        dialog.showMessageBox({
          type: "info",
          title: "You’re trying to open a system folder.",
          message:
            "This folder contains internal operating-system files and is extremely large, which can cause the app to freeze or crash. Please locate your project folder and open that instead.",
          buttons: ["OK"]
        });

        return;
      }
      const main = await windowManager.createWindow(undefined, true);
      main.webContents.on('did-finish-load', async () => {
        const windowId = (main as BrowserWindow & { windowInfo?: { id: string } })?.windowInfo?.id;
        if (windowId) await windowManager.setActiveDirectory(windowId, resolvedPath);
      })

    } else if (stats.isFile()) {
      const newTab = {
        id: crypto.randomUUID(),
        type: "document" as const,
        title: path.basename(resolvedPath),
        source: resolvedPath,
        directory: null,
      };
      const activeWindowId = windowManager.getActiveWindowId();
      if (!activeWindowId) {
        const main = await windowManager.createWindow(undefined, true);
        // Mutate state immediately after createWindow — the window state is
        // already initialized at this point, so the tab will be present when
        // the renderer makes its first state:getPanelTabs call on load.
        const tab = await addPanelTab(undefined, 'main', newTab);
        await activateTab(undefined, 'main', tab.tabId);
        main.webContents.on('did-finish-load', () => {
          main.focus();
        });
      } else {
        const tab = await addPanelTab(undefined, 'main', newTab);
        await activateTab(undefined, 'main', tab.tabId);
        const win = windowManager.browserWindow;
        if (win) {
          win.webContents.send('file:newTab');
          // Only show/focus if the window is already visible — if it's still
          // loading (splash screen up), ready-to-show will handle showing it.
          if (win.isVisible()) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          }
        }
      }
    }
  } catch (error) {
    console.error('[CLI] Error opening path:', error);
    // Fall back to default Voiden directory
    if (windowManager.browserWindow) windowManager.browserWindow.focus();
  }
}

/**
 * Get CLI arguments, handling different execution contexts.
 * Filters out installer/updater flags (e.g. NSIS --updated, --force-run)
 * so they don't trigger the CLI code path on restart after an update.
 */
export function getCliArguments(): string[] {
  let args: string[];

  // In development mode or when launched directly
  if (process.defaultApp || !app.isPackaged) {
    // Skip electron executable and main script
    args = process.argv.slice(2);
  } else {
    // In production (packaged app)
    // On macOS/Linux: ['app-path', 'file.void']
    // On Windows: ['app-path', 'file.void']
    args = process.argv.slice(1);
  }

  // Filter out installer/updater flags that are not real user arguments.
  // NSIS adds --updated and --force-run after a Windows update; Squirrel
  // adds --squirrel-* flags. If these are the only args present, the app
  // should go through the normal loadAllWindows() path, not the CLI path.
  return args.filter(arg =>
    !arg.startsWith('--updated') &&
    !arg.startsWith('--force-run') &&
    !arg.startsWith('--squirrel')
  );
}

/**
 * Handle macOS open-file event (when double-clicking a file or using "Open With").
 * Call this once after the app is ready.
 */
export function setupMacOSFileHandler() {
  if (process.platform !== "darwin") return;
  app.on("open-file", async (event, filePath) => {
    event.preventDefault();
    await handleCliArguments([filePath]);
  });
}

function isSystemFolder(folderPath: string): boolean {
  // Normalize path separators for comparison
  const normalizedPath = folderPath.replace(/\\/g, '/');
  
  // Get user home directory patterns
  const userHome = process.env.HOME || process.env.USERPROFILE || '';
  const normalizedHome = userHome.replace(/\\/g, '/');
  
  // macOS system paths
  const macSystemPaths = [
    '/System',
    '/Library',
    '/private',
    '/bin',
    '/sbin',
    '/usr',
    '/var',
    '/etc',
    '/dev',
    '/cores',
    '/Volumes/Macintosh HD/System',
    '/Volumes/Macintosh HD/Library'
  ];
  
  // Linux system paths
  const linuxSystemPaths = [
    '/bin',
    '/boot',
    '/dev',
    '/etc',
    '/lib',
    '/lib64',
    '/proc',
    '/root',
    '/run',
    '/sbin',
    '/sys',
    '/usr',
    '/var',
    '/opt',
    '/srv',
    '/mnt',
    '/media'
  ];
  
  // Windows system paths
  const windowsSystemPaths = [
    'C:/Windows',
    'C:/Windows/System32',
    'C:/Windows/SysWOW64',
    'C:/Program Files',
    'C:/Program Files (x86)',
    'C:/ProgramData',
    'C:/$Recycle.Bin',
    'C:/System Volume Information'
  ];
  
  // Special case: Block root /Users on macOS (but allow /Users/username/...)
  if (normalizedPath === '/Users') {
    return true;
  }
  
  // Special case: Block root C:/Users on Windows (but allow C:/Users/username/...)
  if (normalizedPath === 'C:/Users' || normalizedPath === 'C:\\Users') {
    return true;
  }
  
  // Special case: Block root /home on Linux (but allow /home/username/...)
  if (normalizedPath === '/home') {
    return true;
  }
  
  // Special case: Block user's home directory root (but allow subdirectories like ~/Desktop)
  if (normalizedHome && normalizedPath === normalizedHome) {
    return true;
  }
  
  // Special case: Block user's Library folder on macOS
  if (normalizedHome && normalizedPath === normalizedHome + '/Library') {
    return true;
  }
  
  // Special case: Block default terminal paths (root directories)
  // macOS and Linux: root directory /
  if (normalizedPath === '/') {
    return true;
  }
  
  // Windows: Drive roots like C:/, D:/, etc.
  if (/^[A-Za-z]:\/?$/.test(normalizedPath)) {
    return true;
  }
  
  // If path is within user's home directory, allow it (except Library which was already checked)
  if (normalizedHome && normalizedPath.startsWith(normalizedHome + '/')) {
    return false;
  }
  
  // Check against all system paths
  const allSystemPaths = [
    ...macSystemPaths,
    ...linuxSystemPaths,
    ...windowsSystemPaths
  ];
  
  // Check if path starts with any system path
  return allSystemPaths.some(systemPath => {
    const normalizedSystemPath = systemPath.replace(/\\/g, '/');
    return normalizedPath.startsWith(normalizedSystemPath);
  });
}