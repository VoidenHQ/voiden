import { HistoryEntry, HistoryFile } from './types';

const HISTORY_VERSION = '1.0.0';

/** Derive a safe filename from a .void file path */
function getHistoryFileName(filePath: string): string {
  const basename = filePath.split('/').pop()?.replace(/\.void$/, '') || 'unknown';
  const sanitized = basename.replace(/[^a-zA-Z0-9-_]/g, '_');
  return `${sanitized}-history.json`;
}

const electronAny = () => (window as any).electron;

function getRetentionCutoff(retentionDays: number): number {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return todayStart - (retentionDays - 1) * 24 * 60 * 60 * 1000;
}

function pruneEntriesByRetention(entries: HistoryEntry[], retentionDays?: number): HistoryEntry[] {
  if (!retentionDays || retentionDays < 1) return entries;
  const cutoff = getRetentionCutoff(retentionDays);
  return entries.filter((e) => e.timestamp >= cutoff);
}

/** Ensure .voiden/history directory exists, only creating what is missing */
async function ensureHistoryDir(projectPath: string, filePath?: string): Promise<void> {
  try {
    // Keep runtime artifacts out of VCS for the active project when .gitignore exists.
    const gitignorePatterns = ['.voiden/*', '.voiden/**'];
    if (filePath) {
      gitignorePatterns.push(`.voiden/history/${getHistoryFileName(filePath)}`);
    }
    await electronAny()?.git?.updateGitignore?.(gitignorePatterns, projectPath);

    const voidenExists = await electronAny()?.files?.getDirectoryExist(projectPath, '.voiden');
    if (!voidenExists) {
      await electronAny()?.files?.createDirectory(projectPath, '.voiden');
    }
    const voidenPath = await electronAny()?.utils?.pathJoin(projectPath, '.voiden');
    if (voidenPath) {
      const historyExists = await electronAny()?.files?.getDirectoryExist(voidenPath, 'history');
      if (!historyExists) {
        await electronAny()?.files?.createDirectory(voidenPath, 'history');
      }
    }
  } catch {}
}

/** Read history file for a given .void file path and optionally prune by retention days */
export async function readHistory(projectPath: string, filePath: string, retentionDays?: number): Promise<HistoryFile> {
  const fileName = getHistoryFileName(filePath);
  try {
    const historyPath = await electronAny()?.utils?.pathJoin(
      projectPath,
      '.voiden',
      'history',
      fileName,
    );
    if (historyPath) {
      const content = await electronAny()?.files?.read(historyPath);
      if (content) {
        const parsed = JSON.parse(content) as HistoryFile;
        const prunedEntries = pruneEntriesByRetention(parsed.entries ?? [], retentionDays);
        const history: HistoryFile = {
          version: parsed.version ?? HISTORY_VERSION,
          filePath: parsed.filePath ?? filePath,
          entries: prunedEntries,
        };

        // Persist if pruning removed stale entries.
        if ((parsed.entries?.length ?? 0) !== prunedEntries.length) {
          await electronAny()?.files?.write(historyPath, JSON.stringify(history, null, 2));
        }

        return history;
      }
    }
  } catch {}
  return { version: HISTORY_VERSION, filePath, entries: [] };
}

/** Append a new entry and prune old ones by retention days, then persist to disk */
export async function appendToHistory(
  projectPath: string,
  filePath: string,
  entry: HistoryEntry,
  retentionDays: number,
): Promise<HistoryFile> {
  await ensureHistoryDir(projectPath, filePath);
  const history = await readHistory(projectPath, filePath, retentionDays);

  history.entries.unshift(entry);
  history.entries = pruneEntriesByRetention(history.entries, retentionDays);

  const fileName = getHistoryFileName(filePath);
  const historyPath = await electronAny()?.utils?.pathJoin(
    projectPath,
    '.voiden',
    'history',
    fileName,
  );
  if (historyPath) {
    await electronAny()?.files?.write(historyPath, JSON.stringify(history, null, 2));
  }

  return history;
}

/** Clear all history for a given .void file */
export async function clearHistory(projectPath: string, filePath: string): Promise<void> {
  await ensureHistoryDir(projectPath, filePath);
  const fileName = getHistoryFileName(filePath);
  const historyPath = await electronAny()?.utils?.pathJoin(
    projectPath,
    '.voiden',
    'history',
    fileName,
  );
  if (historyPath) {
    const empty: HistoryFile = { version: HISTORY_VERSION, filePath, entries: [] };
    await electronAny()?.files?.write(historyPath, JSON.stringify(empty, null, 2));
  }
}

/** Build a minimal cURL command from a history entry for replay */
export function buildCurlFromEntry(entry: HistoryEntry): string {
  const parts: string[] = ['curl'];

  const method = (entry.request.method || 'GET').toUpperCase();
  parts.push(`-X ${method}`);

  parts.push(`"${entry.request.url}"`);

  if (entry.request.headers && entry.request.headers.length > 0) {
    for (const h of entry.request.headers) {
      if (h.key && h.value) {
        const escaped = h.value.replace(/"/g, '\\"');
        parts.push(`-H "${h.key}: ${escaped}"`);
      }
    }
  }

  if (entry.request.body) {
    const escaped = entry.request.body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    parts.push(`-d "${escaped}"`);
  }

  return parts.join(' \\\n  ');
}
