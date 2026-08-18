import { ipcMain } from "electron";
import fs from "fs";
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

  // Walks up from a file's own directory looking for the nearest ancestor
  // with a .voiden marker folder — i.e. "which project actually owns this
  // file", independent of `directory:getActive` (the sidebar's currently-
  // selected project, which can be a completely different, unrelated
  // directory: nothing requires the file a plugin's file picker is being
  // used from to belong to whatever project happens to be active, and it
  // may not even be a "known" open directory at all — e.g. a file opened
  // standalone rather than as part of an opened project folder). Returns
  // null if no ancestor has a .voiden folder (file isn't part of any
  // Voiden project) so callers can fall back to getActive().
  ipcMain.handle("path:findProjectRoot", (_event, filePath: string) => {
    if (!filePath) return null;
    let dir = path.dirname(filePath);
    // Bounded by the filesystem root — path.dirname(root) === root.
    while (true) {
      try {
        if (fs.existsSync(path.join(dir, ".voiden"))) return dir;
      } catch {
        // Permission error or similar — stop walking rather than throw.
        return null;
      }
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  });
}
