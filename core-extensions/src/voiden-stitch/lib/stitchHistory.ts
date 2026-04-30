/**
 * Stitch History — persist run results per source file to .voiden/stitch-runner/
 */

import type { StitchHistoryEntry, StitchRunState } from './types';

const MAX_HISTORY = 20;
const HISTORY_SUBDIR = '.voiden/stitch-runner';

/**
 * Convert an absolute source file path to a safe JSON filename.
 * e.g. /project/api/auth.void → api__auth.void.json
 */
function toHistoryFilename(sourceFilePath: string, projectPath: string): string {
  const rel = sourceFilePath.startsWith(projectPath + '/')
    ? sourceFilePath.slice(projectPath.length + 1)
    : sourceFilePath.replace(/[/:]/g, '_');
  return rel.replace(/[/\\]/g, '__') + '.json';
}

async function ensureHistoryDir(projectPath: string): Promise<boolean> {
  const filesApi = (window as any).electron?.files;
  if (!filesApi) return false;
  try {
    const voidenExists = await filesApi.getDirectoryExist(projectPath, '.voiden');
    if (!voidenExists) {
      await filesApi.createDirectory(projectPath, '.voiden');
    }
    const stitchExists = await filesApi.getDirectoryExist(`${projectPath}/.voiden`, 'stitch-runner');
    if (!stitchExists) {
      await filesApi.createDirectory(`${projectPath}/.voiden`, 'stitch-runner');
    }
    return true;
  } catch {
    return false;
  }
}

export async function saveStitchHistory(
  sourceFilePath: string,
  run: StitchRunState,
): Promise<void> {
  if (!sourceFilePath || !run.id) return;
  try {
    const projects = await (window as any).electron?.state?.getProjects?.();
    const projectPath = projects?.activeProject;
    if (!projectPath) return;

    const ok = await ensureHistoryDir(projectPath);
    if (!ok) return;

    const filename = toHistoryFilename(sourceFilePath, projectPath);
    const filePath = `${projectPath}/${HISTORY_SUBDIR}/${filename}`;

    let entries: StitchHistoryEntry[] = [];
    try {
      const existing = await (window as any).electron?.files?.read?.(filePath);
      if (existing) entries = JSON.parse(existing);
    } catch { /* no existing history */ }

    const entry: StitchHistoryEntry = {
      id: run.id,
      runAt: run.startedAt || Date.now(),
      duration: run.duration,
      status: run.status as 'completed' | 'cancelled' | 'error',
      summary: run.summary,
      files: run.files,
    };

    entries = [entry, ...entries.filter((e) => e.id !== run.id)].slice(0, MAX_HISTORY);
    await (window as any).electron?.files?.write?.(filePath, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error('[voiden-stitch] Failed to save history:', err);
  }
}

export async function deleteStitchHistoryEntry(
  sourceFilePath: string,
  entryId: string,
): Promise<void> {
  if (!sourceFilePath || !entryId) return;
  try {
    const projects = await (window as any).electron?.state?.getProjects?.();
    const projectPath = projects?.activeProject;
    if (!projectPath) return;

    const filename = toHistoryFilename(sourceFilePath, projectPath);
    const filePath = `${projectPath}/${HISTORY_SUBDIR}/${filename}`;

    let entries: StitchHistoryEntry[] = [];
    try {
      const existing = await (window as any).electron?.files?.read?.(filePath);
      if (existing) entries = JSON.parse(existing);
    } catch { return; }

    entries = entries.filter((e) => e.id !== entryId);
    await (window as any).electron?.files?.write?.(filePath, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error('[voiden-stitch] Failed to delete history entry:', err);
  }
}

export async function clearStitchHistory(
  sourceFilePath: string,
): Promise<void> {
  if (!sourceFilePath) return;
  try {
    const projects = await (window as any).electron?.state?.getProjects?.();
    const projectPath = projects?.activeProject;
    if (!projectPath) return;

    const filename = toHistoryFilename(sourceFilePath, projectPath);
    const filePath = `${projectPath}/${HISTORY_SUBDIR}/${filename}`;
    await (window as any).electron?.files?.write?.(filePath, JSON.stringify([], null, 2));
  } catch (err) {
    console.error('[voiden-stitch] Failed to clear history:', err);
  }
}

export async function loadStitchHistory(
  sourceFilePath: string,
): Promise<StitchHistoryEntry[]> {
  if (!sourceFilePath) return [];
  try {
    const projects = await (window as any).electron?.state?.getProjects?.();
    const projectPath = projects?.activeProject;
    if (!projectPath) return [];

    const filename = toHistoryFilename(sourceFilePath, projectPath);
    const filePath = `${projectPath}/${HISTORY_SUBDIR}/${filename}`;

    const content = await (window as any).electron?.files?.read?.(filePath);
    if (!content) return [];
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
