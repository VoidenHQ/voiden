import { create } from "zustand";
import { isPathInsideLockedProject } from "@/core/file-system/hooks/useProjectLock";

export type UnsavedChangesChoice = "save" | "discard" | "cancel";

interface PendingRequest {
  title: string;
  locked: boolean;
  resolve: (choice: UnsavedChangesChoice) => void;
}

interface UnsavedChangesDialogState {
  request: PendingRequest | null;
}

export const useUnsavedChangesDialogStore = create<UnsavedChangesDialogState>(() => ({
  request: null,
}));

/**
 * In-app confirmation used when replacing a dirty pending tab (single-clicking
 * a different file in the tree while the current pending tab has unsaved
 * changes) — see TreeNode.tsx's handleSelect. Renders the prompt as a normal
 * React modal instead of a native window.confirm()/dialog.showMessageBox, so
 * it can't be affected by the Windows webContents-focus-loss issues those
 * native dialogs are prone to.
 */
export function confirmUnsavedChanges(title: string, locked: boolean): Promise<UnsavedChangesChoice> {
  return new Promise((resolve) => {
    useUnsavedChangesDialogStore.setState({ request: { title, locked, resolve } });
  });
}

export function resolveUnsavedChangesDialog(choice: UnsavedChangesChoice) {
  const { request } = useUnsavedChangesDialogStore.getState();
  if (!request) return;
  useUnsavedChangesDialogStore.setState({ request: null });
  request.resolve(choice);
}

/**
 * Confirms (via the dialog above) and, if the user chooses to save, writes
 * the tab's content to disk via the same files:write path manual Cmd+S and
 * autosave already use (falls back to a native save-location picker only for
 * a never-saved/temp tab). Returns false if the caller should abort (user
 * canceled, or a save-as picker was canceled / the write failed).
 */
export async function confirmAndSaveTab(
  tab: { title: string; source: string | null } | undefined,
  tabId: string,
  unsavedContent: string,
): Promise<boolean> {
  const locked = await isPathInsideLockedProject(tab?.source ?? null);
  const choice = await confirmUnsavedChanges(tab?.title ?? "this file", locked);
  if (choice === "cancel") return false;
  if (choice === "save") {
    try {
      const filePath = await window.electron?.files.write(tab?.source ?? null, unsavedContent, tabId);
      if (!filePath) return false; // save-as picker canceled, or write failed
    } catch {
      return false;
    }
  }
  return true;
}
