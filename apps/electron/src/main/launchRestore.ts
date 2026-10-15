import { app } from "electron";
import fs from "fs";
import path from "path";
import { getSettings, type RestoreWindowsMode } from "./settings";

// The "On startup" preference only applies when the user launches Voiden.
// When Voiden restarts itself (an update, a channel switch, a plugin restart)
// the windows that were open must come back, so every such restart leaves this
// marker behind and the next launch restores all windows.
function markerPath() {
  return path.join(app.getPath("userData"), "restore-windows-on-relaunch");
}

/** Call right before Voiden restarts itself. */
export function markRestoreWindowsOnRelaunch() {
  try {
    fs.writeFileSync(markerPath(), String(Date.now()));
  } catch {
    // Worst case the next launch follows the startup preference.
  }
}

/**
 * Which windows to restore for this launch. Reads and clears the relaunch
 * marker, so call it once per launch.
 */
export function takeLaunchRestoreMode(): RestoreWindowsMode {
  let isRelaunch = false;
  try {
    const p = markerPath();
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      isRelaunch = true;
    }
  } catch {
    // Ignore marker errors
  }
  if (isRelaunch) return "all";

  const mode = getSettings().startup?.restore_windows;
  return mode === "last" || mode === "none" ? mode : "all";
}
