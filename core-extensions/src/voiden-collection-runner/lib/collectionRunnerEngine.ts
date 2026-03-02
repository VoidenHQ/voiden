import { useCollectionRunnerStore, FileEntry } from './collectionRunnerStore';

// ─── File extraction from table ───────────────────────────────────────────────

/** Recursively find the first `fileLink` node inside any JSON subtree */
function findFileLinkDeep(node: any): any | null {
  if (!node) return null;
  if (node.type === 'fileLink' && node.attrs?.filePath) return node;
  for (const child of node.content ?? []) {
    const found = findFileLinkDeep(child);
    if (found) return found;
  }
  return null;
}

/** Extract plain text from a table cell (nested: cell → paragraph → text) */
function extractCellText(cell: any): string {
  return (cell.content ?? [])
    .flatMap((para: any) => para.content ?? [])
    .filter((n: any) => n.type === 'text')
    .map((n: any) => n.text ?? '')
    .join('');
}

/**
 * Given the JSON of a `collection-runner` node, return the ordered files to execute.
 *
 * Per row:
 *   1. `fileLink` node (inserted via `@filename`)
 *   2. Plain-text fallback (user typed a relative path)
 *
 * Rows disabled with Cmd+/ are skipped.
 */
export function extractFilesFromNodeJson(nodeJson: any): FileEntry[] {
  const files: FileEntry[] = [];

  // content[0] is the `table` node inside collection-runner
  const table = nodeJson.content?.[0];
  if (!table) return files;

  for (const row of table.content ?? []) {
    if (row.type !== 'tableRow') continue;
    if (row.attrs?.disabled) continue;

    for (const cell of row.content ?? []) {
      if (cell.type !== 'tableCell') continue;

      // Prefer @mention fileLink
      const link = findFileLinkDeep(cell);
      if (link) {
        const path = link.attrs.filePath as string;
        const name = (link.attrs.filename as string) || path.split('/').pop() || path;
        files.push({ id: path, path, name });
        break;
      }

      // Fallback: plain text treated as a relative path
      const text = extractCellText(cell).trim();
      if (text) {
        files.push({ id: text, path: text, name: text.split('/').pop() || text });
        break;
      }
    }
  }

  return files;
}

// ─── Execution ────────────────────────────────────────────────────────────────

/**
 * Execute each linked file serially.
 * Triggered automatically via `onProcessResponse` after the file's own request completes.
 */
export async function runCollection(files: FileEntry[], context: any): Promise<void> {
  const store = useCollectionRunnerStore.getState();
  store.startRun(files);

  // @ts-ignore — resolved at runtime in the app context
  const { requestOrchestrator } = await import(/* @vite-ignore */ '@/core/request-engine/requestOrchestrator');
  // @ts-ignore
  const { useResponseStore } = await import(/* @vite-ignore */ '@/core/request-engine/stores/responseStore');

  for (const file of files) {
    store.updateFileStatus(file.id, 'running');

    const responseKey = `collection:${file.id}`;

    try {
      // fileLink stores a relative path — join with the active project root
      // to get the absolute path that electron's files.read() requires.
      const projectPath = await context.project.getPath();
      const absolutePath =
        projectPath
          ? await (window as any).electron?.utils?.pathJoin(projectPath, file.path) ?? file.path
          : file.path;

      const markdown = await context.files.read(absolutePath);
      if (!markdown) throw new Error(`Could not read: ${absolutePath}`);

      const docJson = context.helpers.parseVoid(markdown);

      // Minimal mock editor — plugin onBuildRequest handlers only call getJSON()
      const mockEditor = {
        getJSON: () => docJson,
        isEmpty: false,
        state: null as any,
        schema: null as any,
        storage: {},
        commands: {},
      };

      // Route this file's response to our key via the existing currentRequestTabId mechanism
      useResponseStore.getState().setLoading(true, responseKey);

      await requestOrchestrator.executeRequest(mockEditor as any);

      const stored = useResponseStore.getState().getResponse(responseKey);
      store.setFileResponse(file.id, stored?.responseDoc ?? null);
    } catch (err) {
      store.updateFileStatus(file.id, 'error');
      store.setFileError(file.id, err instanceof Error ? err.message : String(err));
    }
  }

  store.completeRun();
}
