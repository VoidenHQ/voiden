/**
 * Records which Git version of a .void file a request ran from, so history can tell apart
 * responses from different versions of the same request.
 */

import type { HistoryEntry, HistoryEntryCommit } from './types';

/** Short form of a commit hash, the same length Commit History shows. */
export const shortCommitHash = (hash: string): string => hash.slice(0, 7);

/** True when an open tab of `filePath` has edits that are not saved to disk yet. */
async function hasUnsavedEdits(filePath: string): Promise<boolean> {
  const tabs = await window.electron?.state.getPanelTabs('main');
  const { useEditorStore } = await import('@/core/editors/voiden/VoidenEditor');
  const unsaved = useEditorStore.getState().unsaved;
  return (tabs?.tabs ?? []).some((t: any) => t.type === 'document' && t.source === filePath && !!unsaved[t.id]);
}

/**
 * The commit `filePath` is at, for a history entry. Unsaved edits count as uncommitted
 * changes, because requests are sent from the editor's content, not from the file on disk.
 * Undefined when the file isn't committed in a Git repository. Never throws.
 */
export async function captureFileCommit(filePath: string): Promise<HistoryEntryCommit | undefined> {
  try {
    const [commit, unsaved] = await Promise.all([
      window.electron?.git?.getFileCommit?.(filePath),
      hasUnsavedEdits(filePath).catch(() => false),
    ]);
    if (!commit?.hash) return undefined;
    return { hash: commit.hash, subject: commit.subject ?? '', dirty: commit.dirty || unsaved };
  } catch {
    return undefined;
  }
}

/**
 * True when a history search looks like the commit an entry ran at: a hash prefix of at
 * least 4 characters (git's shortest abbreviation), so short queries like "20" still only
 * match status codes and text.
 */
export function matchesCommit(entry: Pick<HistoryEntry, 'commit'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length >= 4 && !!entry.commit?.hash.toLowerCase().startsWith(q);
}
