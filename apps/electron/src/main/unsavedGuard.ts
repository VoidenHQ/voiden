import { BrowserWindow, dialog } from "electron";
import { flushRendererUnsavedForPaths, getUnsavedTabTitles } from "./fileSystem";

// Asking about unsaved tabs before they are thrown away. Two things can throw
// them away: quitting the app, and closing a window. Both go through
// resolveUnsavedTabs.
//
// Closing a window is guarded here rather than in the quit handler because on
// Windows and Linux closing the last window IS how the app quits: by the time
// "before-quit" runs the window is gone, and there is nothing left to ask.

// Set once the user has agreed to quit (or the app is restarting to install an
// update). Windows closing after that must not ask again.
let quitApproved = false;

export function approveQuit(): void {
  quitApproved = true;
}

// Windows the user has already answered for, and windows with a prompt open.
const approvedToClose = new WeakSet<BrowserWindow>();
const asking = new WeakSet<BrowserWindow>();

/**
 * If any of `windows` has unsaved tabs, ask what to do with them and do it.
 * Resolves true when it is fine to go ahead (nothing unsaved, everything
 * saved, or the user chose not to save), and false when the user backed out.
 *
 * @param action what is about to happen, for the wording of the buttons
 */
export async function resolveUnsavedTabs(windows: BrowserWindow[], parent: BrowserWindow | null | undefined, action: "quit" | "close"): Promise<boolean> {
  const unsavedTitles = await getUnsavedTabTitles(windows);
  if (unsavedTitles.length === 0) return true;

  const owner = parent && !parent.isDestroyed() ? parent : undefined;
  const ask = (options: Electron.MessageBoxOptions) => (owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options));

  const { response } = await ask({
    type: "warning",
    buttons: [action === "quit" ? "Save All & Quit" : "Save All & Close", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "Unsaved Changes",
    message: unsavedTitles.length === 1
      ? `"${unsavedTitles[0]}" has unsaved changes.`
      : `${unsavedTitles.length} tabs have unsaved changes.`,
    detail: unsavedTitles.length > 1 ? unsavedTitles.map((t) => `• ${t}`).join("\n") : undefined,
  });

  if (response === 2) return false; // Cancel
  if (response === 1) return true; // Don't Save

  // Save All. Untitled files have no path yet, so each one asks where to
  // save; cancelling one of those means "don't go ahead after all".
  const saved = await flushRendererUnsavedForPaths([], { includeUntitled: true, windows });
  if (saved.cancelled) return false;
  if (saved.failed.length === 0) return true;

  const { response: failedResponse } = await ask({
    type: "error",
    buttons: [action === "quit" ? "Quit Anyway" : "Close Anyway", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Could Not Save",
    message: saved.failed.length === 1
      ? `"${saved.failed[0]}" could not be saved.`
      : `${saved.failed.length} tabs could not be saved.`,
    detail: [
      saved.failed.length > 1 ? saved.failed.map((t) => `• ${t}`).join("\n") : "",
      "Going ahead will lose those changes.",
    ].filter(Boolean).join("\n\n"),
  });
  return failedResponse === 0;
}

/**
 * Make closing `win` (the title bar's close button, the taskbar or dock menu,
 * a keyboard shortcut) ask about its unsaved tabs first.
 */
export function guardUnsavedOnClose(win: BrowserWindow): void {
  win.on("close", (event) => {
    if (quitApproved || approvedToClose.has(win)) return;
    // Nothing can be asked of a window whose page is gone.
    if (win.webContents.isDestroyed() || win.webContents.isCrashed()) return;

    event.preventDefault();
    if (asking.has(win)) return;
    asking.add(win);

    void (async () => {
      try {
        if (!(await resolveUnsavedTabs([win], win, "close"))) return;
        approvedToClose.add(win);
        if (!win.isDestroyed()) win.close();
      } catch {
        // Never trap the user in a window that cannot be closed.
        approvedToClose.add(win);
        if (!win.isDestroyed()) win.close();
      } finally {
        asking.delete(win);
      }
    })();
  });
}
