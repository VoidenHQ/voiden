import { FileAttachmentMeta, HistoryEntry, HistoryEntryWithFile, HistoryFile } from './types';

export interface AttachmentChange {
  key: string;
  name: string;
  status: 'modified' | 'missing';
  oldSize?: number;
  newSize?: number;
}

/** Re-hash each file attachment and return those that have changed since capture time */
export async function checkAttachmentChanges(entry: HistoryEntry): Promise<AttachmentChange[]> {
  const attachments = (entry.request.fileAttachments ?? []).filter(
    (a: FileAttachmentMeta) => a.path && a.hash,
  );
  if (attachments.length === 0) return [];

  const results = await Promise.allSettled(
    attachments.map(async (att: FileAttachmentMeta): Promise<AttachmentChange | null> => {
      try {
        const result = await electronAny()?.files?.hash?.(att.path!) ?? null;
        if (!result?.exists) {
          return { key: att.key, name: att.name, status: 'missing', oldSize: att.size };
        }
        if (result.hash !== att.hash) {
          return { key: att.key, name: att.name, status: 'modified', oldSize: att.size, newSize: result.size };
        }
        return null;
      } catch {
        return { key: att.key, name: att.name, status: 'missing', oldSize: att.size };
      }
    }),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<AttachmentChange> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map((r) => r.value);
}

const HISTORY_VERSION = '1.0.0';

/** Derive a safe filename from a .void file path */
function getHistoryFileName(filePath: string): string {
  const basename = filePath.split('/').pop()?.replace(/\.void$/, '') || 'unknown';
  const sanitized = basename.replace(/[^a-zA-Z0-9-_]/g, '_');
  return `${sanitized}-history.json`;
}

const electronAny = () => (window as any).electron;

/**
 * Per-file write lock — serialises concurrent read-modify-write cycles so that
 * two callers targeting the same history file never interleave their writes.
 */
const writeQueues = new Map<string, Promise<void>>();

function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(key) ?? Promise.resolve();
  let unlock!: () => void;
  const current = new Promise<void>((r) => { unlock = r; });
  writeQueues.set(key, current);
  return prev.then(async () => {
    try {
      return await fn();
    } finally {
      unlock();
      if (writeQueues.get(key) === current) writeQueues.delete(key);
    }
  });
}

/** Clamp retention days to the valid range [1, 90]. Always applied before pruning. */
function clampRetentionDays(days: number): number {
  return Math.min(90, Math.max(1, days));
}

function getRetentionCutoff(retentionDays: number): number {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return todayStart - (retentionDays - 1) * 24 * 60 * 60 * 1000;
}

function pruneEntriesByRetention(entries: HistoryEntry[], retentionDays?: number): HistoryEntry[] {
  if (!retentionDays || retentionDays < 1) return entries;
  const clamped = clampRetentionDays(retentionDays);
  const cutoff = getRetentionCutoff(clamped);
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
export function appendToHistory(
  projectPath: string,
  filePath: string,
  entry: HistoryEntry,
  retentionDays: number,
): Promise<HistoryFile> {
  const lockKey = `${projectPath}::${getHistoryFileName(filePath)}`;
  return withWriteLock(lockKey, async () => {
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
  });
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

/**
 * Read all history entries across every .void file in the project.
 * Returns a flat list sorted newest-first, each entry annotated with its source file path.
 */
export async function readAllHistory(projectPath: string, retentionDays?: number): Promise<HistoryEntryWithFile[]> {
  try {
    const historyDirPath = await electronAny()?.utils?.pathJoin(projectPath, '.voiden', 'history');
    if (!historyDirPath) return [];

    const fileNames: string[] = await electronAny()?.files?.listDir(historyDirPath) ?? [];
    const jsonFiles = fileNames.filter((name: string) => name.endsWith('.json'));

    const allEntries: HistoryEntryWithFile[] = [];

    await Promise.all(
      jsonFiles.map(async (fileName: string) => {
        try {
          const filePath = await electronAny()?.utils?.pathJoin(historyDirPath, fileName);
          if (!filePath) return;
          const content = await electronAny()?.files?.read(filePath);
          if (!content) return;
          const parsed = JSON.parse(content) as HistoryFile;
          const entries = pruneEntriesByRetention(parsed.entries ?? [], retentionDays);

          // Persist if pruning removed stale entries (same as readHistory does)
          if ((parsed.entries?.length ?? 0) !== entries.length) {
            const pruned: HistoryFile = {
              version: parsed.version ?? HISTORY_VERSION,
              filePath: parsed.filePath ?? '',
              entries,
            };
            await electronAny()?.files?.write(filePath, JSON.stringify(pruned, null, 2));
          }

          entries.forEach((e) => allEntries.push({ ...e, filePath: parsed.filePath ?? '' }));
        } catch { /* skip corrupt files */ }
      }),
    );

    return allEntries.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/** Clear all history files in the project (writes empty entry lists, preserving file structure) */
export async function clearAllHistory(projectPath: string): Promise<void> {
  try {
    const historyDirPath = await electronAny()?.utils?.pathJoin(projectPath, '.voiden', 'history');
    if (!historyDirPath) return;
    const fileNames: string[] = await electronAny()?.files?.listDir(historyDirPath) ?? [];
    const jsonFiles = fileNames.filter((name: string) => name.endsWith('.json'));
    await Promise.all(
      jsonFiles.map(async (fileName: string) => {
        try {
          const filePath = await electronAny()?.utils?.pathJoin(historyDirPath, fileName);
          if (!filePath) return;
          const content = await electronAny()?.files?.read(filePath);
          if (!content) return;
          const parsed = JSON.parse(content) as HistoryFile;
          const empty: HistoryFile = { version: HISTORY_VERSION, filePath: parsed.filePath ?? '', entries: [] };
          await electronAny()?.files?.write(filePath, JSON.stringify(empty, null, 2));
        } catch { /* skip corrupt files */ }
      }),
    );
  } catch { }
}

/** Remove specific entry IDs from their respective history files */
export async function removeEntriesFromHistory(
  projectPath: string,
  filePathToIds: Map<string, string[]>,
): Promise<void> {
  await Promise.all(
    Array.from(filePathToIds.entries()).map(async ([voidFilePath, idsToRemove]) => {
      try {
        const idSet = new Set(idsToRemove);
        const history = await readHistory(projectPath, voidFilePath);
        history.entries = history.entries.filter((e) => !idSet.has(e.id));
        const historyPath = await electronAny()?.utils?.pathJoin(
          projectPath,
          '.voiden',
          'history',
          getHistoryFileName(voidFilePath),
        );
        if (historyPath) {
          await electronAny()?.files?.write(historyPath, JSON.stringify(history, null, 2));
        }
      } catch { }
    }),
  );
}

/**
 * Read all history entries for a specific plugin source across the whole project.
 * Useful for plugins that want to retrieve only their own saved sessions.
 */
export async function readHistoryBySource(
  projectPath: string,
  source: string,
  retentionDays?: number,
): Promise<HistoryEntryWithFile[]> {
  const all = await readAllHistory(projectPath, retentionDays);
  return all.filter((e) => e.source === source);
}

/** Build a minimal cURL command from a history entry for replay */
export function buildCurlFromEntry(entry: HistoryEntry, projectPath?: string): string {
  const parts: string[] = ['curl'];

  const method = (entry.request.method || 'GET').toUpperCase();
  parts.push(`-X ${method}`);
  parts.push(`"${entry.request.url}"`);

  // Determine effective content type
  const contentType = entry.request.contentType;
  const hasContentTypeHeader = entry.request.headers?.some(
    (h) => h.key.toLowerCase() === 'content-type',
  ) ?? false;
  const effectiveContentType = (
    entry.request.headers?.find((h) => h.key.toLowerCase() === 'content-type')?.value ??
    contentType ??
    ''
  ).toLowerCase();
  const isMultipart = effectiveContentType.includes('multipart');

  // Output explicit headers (skip Content-Type for multipart — curl sets it with correct boundary)
  if (entry.request.headers && entry.request.headers.length > 0) {
    for (const h of entry.request.headers) {
      if (!h.key || !h.value) continue;
      if (isMultipart && h.key.toLowerCase() === 'content-type') continue;
      const escaped = h.value.replace(/"/g, '\\"');
      parts.push(`-H "${h.key}: ${escaped}"`);
    }
  }

  // Inject Content-Type from body-node field if absent in headers (non-multipart only)
  if (contentType && !hasContentTypeHeader && !isMultipart) {
    parts.push(`-H "Content-Type: ${contentType}"`);
  }

  if (isMultipart) {
    const fileKeys = new Set((entry.request.fileAttachments ?? []).map((a) => a.key));
    for (const att of (entry.request.fileAttachments ?? [])) {
      let filePath = att.path ?? att.name;
      // If path is not absolute, resolve it relative to the project root so
      // the generated -F flag works regardless of the shell's working directory.
      if (projectPath && filePath) {
        // A path is truly absolute only if it begins with the projectPath prefix or is a
        // Windows drive-letter path. A leading "/" alone is insufficient — fileLink nodes
        // store project-relative paths like "/README.md" that start with "/" but are NOT
        // filesystem-absolute.
        const isAbsolute = filePath.startsWith(projectPath) || /^[A-Za-z]:[/\\]/.test(filePath);
        if (!isAbsolute) {
          filePath = projectPath.replace(/[/\\]+$/, '') + '/' + filePath.replace(/^[/\\]+/, '');
        }
      }
      parts.push(`-F "${att.key}=@${filePath}"`);
    }

    // Also output text (non-file) fields from the pipe-separated body summary
    if (entry.request.body) {
      for (const field of entry.request.body.split(' | ')) {
        const eqIdx = field.indexOf('=');
        if (eqIdx === -1) continue;
        const key = field.slice(0, eqIdx).trim();
        if (fileKeys.has(key)) continue; // already added as -F file
        const val = field.slice(eqIdx + 1).trim();
        if (val.startsWith('@')) continue; // file reference — skip (handled above)
        parts.push(`-F "${key}=${val}"`);
      }
    }
  } else if (entry.request.body) {
    const escaped = entry.request.body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    parts.push(`-d "${escaped}"`);
  }

  return parts.join(' \\\n  ');
}
