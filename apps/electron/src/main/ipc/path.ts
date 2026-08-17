import { ipcMain } from "electron";
import path from "path";

/**
 * Small path-math IPC surface for the renderer/plugins, which have no direct
 * Node `path` access (context isolation — see how `directoriesApi.getActive()`
 * is the renderer's only way to learn the project root, same reasoning here).
 *
 * Exists specifically so a plugin's UI (e.g. voiden-mcp-tool's FilePickerCell)
 * can save a cross-file reference relative to the project root instead of the
 * OS file dialog's raw absolute path — the same reference then has to resolve
 * back to an absolute path wherever it's actually read, in-app or on a cloud
 * VM with a totally different absolute path (see resolvePath() in
 * plugins/voiden-mcp-tool/src/lib/toolCapability.ts, the headless/CI mirror
 * of toAbsolute() below).
 */
export function registerPathIpcHandlers() {
  ipcMain.handle("path:toRelative", (_event, base: string, target: string) => {
    // Forward-slash, not path.sep — this value is stored in a .void file's
    // YAML and may later be read back on a different OS (e.g. a Linux cloud
    // VM), so it needs to be portable, not just correct on this machine.
    return path.relative(base, target).split(path.sep).join("/");
  });

  ipcMain.handle("path:toAbsolute", (_event, base: string, maybeRelative: string) => {
    if (!maybeRelative) return maybeRelative;
    return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(base, maybeRelative);
  });
}
