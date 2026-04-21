/**
 * Stitch Execution Engine
 *
 * Orchestrates batch execution of multiple .void files.
 * Reuses the existing requestOrchestrator pipeline for each file/section.
 */

import type { StitchConfig, StitchFileResult, StitchSectionResult, AssertionResult } from './types';
import { stitchStore } from './stitchStore';

/** Minimal glob matcher supporting * and ** patterns. */
function matchGlob(pattern: string, filePath: string): boolean {
  // Normalize separators
  const p = pattern.replace(/\\/g, '/');
  const f = filePath.replace(/\\/g, '/');

  // Convert glob pattern to regex
  // Handle **/ as "zero or more directory segments" (including no directory)
  const regexStr = p
    .replace(/[.+^${}()|[\]]/g, '\\$&')  // escape special regex chars (not * and ?)
    .replace(/\/\*\*\//g, '{{SLASHGLOBSTARSLASH}}')  // /**/  → matches / or /any/path/
    .replace(/\*\*/g, '{{GLOBSTAR}}')                 // **    → matches anything
    .replace(/\*/g, '[^/]*')                           // *     → matches within a segment
    .replace(/\?/g, '[^/]')                            // ?     → single char
    .replace(/\{\{SLASHGLOBSTARSLASH\}\}/g, '(?:/|/.*/)')  // zero or more dirs
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');                    // anything

  return new RegExp(`^${regexStr}$`).test(f);
}

/** Check if a relative path matches any pattern in the list. */
function matchesAny(patterns: string[], relativePath: string): boolean {
  return patterns.some((p) => matchGlob(p, relativePath));
}

interface EngineContext {
  /** The currently active environment variables */
  activeEnv: Record<string, string> | undefined;
  /** All environments data for environment override */
  allEnvs?: { data: Record<string, Record<string, string>> };
  /** Callback to open the results sidebar tab */
  openResultsTab: () => void;
  /** Tab ID of the editor that triggered the run — used for temp/unsaved file lookup */
  tabId?: string;
}

export async function runStitch(
  config: StitchConfig,
  currentFilePath: string,
  ctx: EngineContext,
  signal: AbortSignal,
) {
  // 1. Import internals via dynamic Vite imports
  // @ts-ignore - Vite dynamic import
  const orchestratorMod = import(/* @vite-ignore */ '@/core/request-engine/requestOrchestrator') as Promise<any>;
  // @ts-ignore - Vite dynamic import
  const baseExtensionsMod = import(/* @vite-ignore */ '@/core/editors/voiden/extensions') as Promise<any>;
  // @ts-ignore - Vite dynamic import
  const editorStoreMod = import(/* @vite-ignore */ '@/plugins') as Promise<any>;

  // @ts-ignore - Vite dynamic import
  const converterMod = import(/* @vite-ignore */ '@/core/editors/voiden/markdownConverter') as Promise<any>;

  // @ts-ignore - Vite dynamic import
  const responseStoreMod = import(/* @vite-ignore */ '@/core/request-engine/stores/responseStore') as Promise<any>;

  const [{ requestOrchestrator }, { voidenExtensions }, pluginsMod, { parseMarkdown }, { useResponseStore }] = await Promise.all([
    orchestratorMod, baseExtensionsMod, editorStoreMod, converterMod, responseStoreMod,
  ]);

  // Combine base extensions with plugin-registered extensions (method, url, headers-table, etc.)
  const pluginExtensions = pluginsMod.useEditorEnhancementStore?.getState?.()?.voidenExtensions || [];
  const allExtensions = [...voidenExtensions, ...pluginExtensions];

  const { Editor, getSchema } = await import('@tiptap/core');
  const schema = getSchema(allExtensions);

  // 2. Discover files
  const allFiles: any[] = (await (window as any).electron?.files?.getVoidFiles?.()) || [];
  const projects = await (window as any).electron?.state?.getProjects?.();
  const projectPath = projects?.activeProject || '';

  // Build relative paths and filter
  const candidates = allFiles
    .filter((f: any) => f.source !== currentFilePath)
    .map((f: any) => ({
      ...f,
      relativePath: f.source.startsWith(projectPath)
        ? f.source.slice(projectPath.length + 1).replace(/\\/g, '/')
        : f.title,
    }));

  const matchedFiles = candidates.filter((f: any) => {
    const included = config.include.length === 0 || matchesAny(config.include, f.relativePath);
    const excluded = config.exclude.length > 0 && matchesAny(config.exclude, f.relativePath);
    return included && !excluded;
  });

  // Sort alphabetically by relative path for deterministic ordering
  matchedFiles.sort((a: any, b: any) => a.relativePath.localeCompare(b.relativePath));

  // Build a map of all void files by relative path for linked block resolution
  const allVoidFilesByPath = new Map<string, any>();
  for (const f of allFiles) {
    const rel = f.source.startsWith(projectPath)
      ? f.source.slice(projectPath.length + 1).replace(/\\/g, '/')
      : f.title;
    allVoidFilesByPath.set(rel, f);
    // Also index by absolute source path
    allVoidFilesByPath.set(f.source, f);
  }

  if (matchedFiles.length === 0) {
    return { matchedCount: 0 };
  }

  // 3. Start run in store
  stitchStore.startRun(
    matchedFiles.map((f: any) => ({ filePath: f.source, fileName: f.relativePath })),
    currentFilePath,
    ctx.tabId,
  );
  ctx.openResultsTab();

  // 4. Snapshot runtime variables for isolation
  const variablesApi = (window as any).electron?.variables;
  let variableSnapshot: Record<string, any> = {};
  try {
    variableSnapshot = (await variablesApi?.read?.()) || {};
  } catch {
    // If we can't read variables, continue without snapshot
  }

  // If a specific environment is selected, temporarily switch to it
  const envApi = (window as any).electron?.env;
  let originalActiveEnv: string | null = null;
  if (config.environment && envApi?.setActive) {
    try {
      const envData = await envApi.load?.();
      originalActiveEnv = envData?.activeEnv || null;
      if (config.environment !== originalActiveEnv) {
        await envApi.setActive(config.environment);
      } else {
        originalActiveEnv = null; // no need to restore
      }
    } catch { /* best effort */ }
  }

  const activeEnv = config.environment && ctx.allEnvs?.data?.[config.environment]
    ? ctx.allEnvs.data[config.environment]
    : ctx.activeEnv;

  try {
    for (let fileIdx = 0; fileIdx < matchedFiles.length; fileIdx++) {
      if (signal.aborted) {
        stitchStore.cancelRun();
        break;
      }

      const file = matchedFiles[fileIdx];
      stitchStore.setFileRunning(fileIdx);

      // If isolateFiles, restore variables to snapshot before each file
      if (config.isolateFiles && fileIdx > 0) {
        try {
          await variablesApi?.writeVariables?.(variableSnapshot);
        } catch { /* best effort */ }
      }

      const fileStart = Date.now();
      const sections: StitchSectionResult[] = [];
      let fileError: string | undefined;
      let hasFailedAssertion = false;

      try {
        // Read file content (use the content from getVoidFiles if available)
        let content = file.content;
        if (!content) {
          content = await (window as any).electron?.files?.read?.(file.source);
        }
        if (!content) {
          throw new Error(`Could not read file: ${file.source}`);
        }

        // Parse to ProseMirror doc using the full schema (preserves UIDs for linked blocks)
        let docJson = parseMarkdown(content, schema);
        if (!docJson?.content) {
          throw new Error(`Failed to parse void file: ${file.source}`);
        }

        // Pre-expand linkedFile nodes (inline entire referenced files).
        try {
          docJson = await expandLinkedFilesForStitch(docJson, allVoidFilesByPath, schema, parseMarkdown);
        } catch (err) {
          console.warn('[voiden-stitch] Failed to expand linked files for', file.relativePath, err);
        }

        // Pre-expand linkedBlock nodes.
        try {
          docJson = await expandLinkedBlocksForStitch(docJson, file.source, allVoidFilesByPath, schema, parseMarkdown);
        } catch (err) {
          console.warn('[voiden-stitch] Failed to expand linked blocks for', file.relativePath, err);
        }

        // Create headless TipTap editor with all registered extensions
        const headlessEditor = new Editor({
          extensions: allExtensions,
          content: docJson,
        });

        try {
          // Count sections
          let sectionCount = 1;
          let firstNodeIsSeparator = false;
          let firstChild = true;
          headlessEditor.state.doc.forEach((child: any) => {
            if (firstChild && child.type.name === 'request-separator') firstNodeIsSeparator = true;
            firstChild = false;
            if (child.type.name === 'request-separator') sectionCount++;
          });
          const startSection = firstNodeIsSeparator ? 1 : 0;

          // Execute each section
          for (let sectionIdx = startSection; sectionIdx < sectionCount; sectionIdx++) {
            if (signal.aborted) break;

            const sectionStart = Date.now();
            let sectionResult: StitchSectionResult;

            try {
              useResponseStore.getState().setCurrentRequestTabId('__stitch__');
              const response = await requestOrchestrator.executeRequest(
                headlessEditor,
                activeEnv,
                signal,
                { sectionIndex: sectionIdx },
              );

              // Extract assertion results from response metadata
              const assertionResults = extractAssertionResults(response);
              const sectionFailed = assertionResults.failed > 0 || !!response?.error;
              if (sectionFailed) hasFailedAssertion = true;

              // Extract request/response details for inspection
              const reqMeta = response?.requestMeta || response?.request || {};
              const resHeaders = response?.headers;
              const resBody = response?.body;
              const bodyStr = typeof resBody === 'string'
                ? resBody
                : resBody != null
                  ? JSON.stringify(resBody, null, 2)
                  : undefined;
              const reqBody = reqMeta.body || response?.requestBody;
              const reqBodyStr = typeof reqBody === 'string'
                ? reqBody
                : reqBody != null
                  ? JSON.stringify(reqBody, null, 2)
                  : undefined;

              sectionResult = {
                sectionIndex: sectionIdx,
                sectionLabel: response?.__sectionLabel || null,
                status: response?.status ?? response?.statusCode ?? response?.httpStatus ?? null,
                statusText: response?.statusText ?? response?.httpStatusText ?? null,
                duration: Date.now() - sectionStart,
                error: response?.error || null,
                assertions: assertionResults,
                requestInfo: {
                  method: reqMeta.method || response?.method || 'GET',
                  url: reqMeta.url || response?.url || '',
                  headers: Array.isArray(reqMeta.headers) ? reqMeta.headers : undefined,
                  body: reqBodyStr ? (reqBodyStr.length > 5000 ? reqBodyStr.slice(0, 5000) + '\n... (truncated)' : reqBodyStr) : undefined,
                  bodySize: reqBodyStr?.length,
                },
                responseInfo: {
                  headers: Array.isArray(resHeaders) ? resHeaders : undefined,
                  body: bodyStr ? (bodyStr.length > 5000 ? bodyStr.slice(0, 5000) + '\n... (truncated)' : bodyStr) : undefined,
                  bodySize: bodyStr?.length,
                  contentType: response?.contentType,
                },
              };
            } catch (err) {
              hasFailedAssertion = true;
              sectionResult = {
                sectionIndex: sectionIdx,
                sectionLabel: null,
                status: null,
                statusText: null,
                duration: Date.now() - sectionStart,
                error: err instanceof Error ? err.message : String(err),
                assertions: { total: 0, passed: 0, failed: 0, results: [] },
              };
            }

            sections.push(sectionResult);
          }
        } finally {
          headlessEditor.destroy();
        }
      } catch (err) {
        fileError = err instanceof Error ? err.message : String(err);
        hasFailedAssertion = true;
      }

      // Compute file-level assertion totals
      const fileAssertions = sections.reduce(
        (acc, s) => ({
          total: acc.total + s.assertions.total,
          passed: acc.passed + s.assertions.passed,
          failed: acc.failed + s.assertions.failed,
        }),
        { total: 0, passed: 0, failed: 0 }
      );

      const fileStatus: StitchFileResult['status'] = fileError
        ? 'error'
        : hasFailedAssertion
          ? 'failed'
          : 'passed';

      stitchStore.updateFileResult(fileIdx, {
        status: fileStatus,
        duration: Date.now() - fileStart,
        sections,
        error: fileError,
        assertions: fileAssertions,
      });

      // Stop on failure if configured
      if (config.stopOnFailure && hasFailedAssertion) {
        // Mark remaining files as skipped
        for (let i = fileIdx + 1; i < matchedFiles.length; i++) {
          stitchStore.updateFileResult(i, { status: 'skipped' });
        }
        break;
      }

      // Delay between files
      if (config.delayBetweenFiles > 0 && fileIdx < matchedFiles.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, config.delayBetweenFiles));
      }
    }

    if (!signal.aborted) {
      stitchStore.completeRun();
    }
  } finally {
    // Restore variables to pre-run snapshot
    try {
      await variablesApi?.writeVariables?.(variableSnapshot);
    } catch { /* best effort */ }

    // Restore original active environment if we switched it
    if (originalActiveEnv && envApi?.setActive) {
      try {
        await envApi.setActive(originalActiveEnv);
      } catch { /* best effort */ }
    }
  }

  return { matchedCount: matchedFiles.length };
}

/** Extract assertion results from a response object. */
function extractAssertionResults(response: any): {
  total: number;
  passed: number;
  failed: number;
  results: AssertionResult[];
} {
  const results: AssertionResult[] = [];

  // Simple assertions plugin stores results in metadata as { results, totalAssertions, ... }
  const assertionData = response?.metadata?.assertionResults;
  const assertionResults = Array.isArray(assertionData)
    ? assertionData
    : Array.isArray(assertionData?.results)
      ? assertionData.results
      : [];
  for (const r of assertionResults) {
    // Results have nested assertion object: { assertion: { description, field, operator, expectedValue }, passed, actualValue, error }
    const assertion = r.assertion || {};
    results.push({
      description: assertion.description || r.description || '',
      passed: r.passed ?? false,
      operator: assertion.operator || r.operator,
      actual: r.actualValue != null ? String(r.actualValue) : r.actual != null ? String(r.actual) : undefined,
      expected: assertion.expectedValue != null ? String(assertion.expectedValue) : r.expected != null ? String(r.expected) : undefined,
      error: r.error,
    });
  }

  // Script assertions
  const scriptAssertions = response?.metadata?.scriptAssertionResults;
  if (Array.isArray(scriptAssertions)) {
    for (const r of scriptAssertions) {
      results.push({
        description: r.message || r.description || '',
        passed: r.passed ?? r.status === 'passed',
        operator: r.operator,
        actual: r.actual != null ? String(r.actual) : undefined,
        expected: r.expected != null ? String(r.expected) : undefined,
        error: r.error,
      });
    }
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };
}

/** Returns blocks belonging to the section introduced by the separator with the given uid. */
export function getBlocksForSection(content: any[], sectionUid: string): any[] {
  let inSection = false;
  const blocks: any[] = [];
  for (const node of content) {
    if (node.type === 'request-separator') {
      if (inSection) break;
      if (node.attrs?.uid === sectionUid) inSection = true;
    } else if (inSection) {
      blocks.push(node);
    }
  }
  return blocks;
}

/**
 * Expand linkedFile nodes in document JSON by inlining each referenced file's blocks.
 * Uses the stitch engine's allVoidFilesByPath cache so no extra IPC calls are needed.
 */
async function expandLinkedFilesForStitch(
  json: any,
  filesByPath: Map<string, any>,
  schema: any,
  parseMarkdownFn: (markdown: string, schema: any) => any,
): Promise<any> {
  if (!json?.content || !Array.isArray(json.content)) return json;
  if (!json.content.some((n: any) => n.type === 'linkedFile')) return json;

  const expandedContent: any[] = [];

  for (const node of json.content) {
    if (node.type !== 'linkedFile') {
      expandedContent.push(node);
      continue;
    }

    const originalFile = node.attrs?.originalFile;
    const sectionUid: string | null = node.attrs?.sectionUid ?? null;
    if (!originalFile) continue;

    try {
      const normalizedFile = originalFile.replace(/\\/g, '/').replace(/^\//, '');
      const sourceFile = filesByPath.get(originalFile) || filesByPath.get(normalizedFile);

      if (!sourceFile) {
        console.warn('[voiden-stitch] Could not find linked file:', originalFile);
        continue;
      }

      let content = sourceFile.content;
      if (!content) {
        content = await (window as any).electron?.files?.read?.(sourceFile.source);
      }
      if (!content) continue;

      const parsed = parseMarkdownFn(content, schema);
      if (!parsed?.content) continue;

      const markImported = (n: any): any => ({
        ...n,
        attrs: { ...n.attrs, importedFrom: originalFile },
        ...(n.content && { content: n.content.map(markImported) }),
      });

      let blocks: any[];
      if (sectionUid !== null) {
        // Section-specific import: extract only that section's blocks.
        blocks = getBlocksForSection(parsed.content, sectionUid);
      } else {
        // Whole-file import: drop leading request-separator (parent provides it).
        blocks = parsed.content[0]?.type === 'request-separator'
          ? parsed.content.slice(1)
          : parsed.content;
      }

      expandedContent.push(...blocks.map(markImported));
    } catch (err) {
      console.warn('[voiden-stitch] Error expanding linked file:', originalFile, err);
    }
  }

  return { ...json, content: expandedContent };
}

/**
 * Expand linkedBlock nodes in document JSON using the stitch engine's own file cache.
 * This avoids the path resolution issues in the core expandLinkedBlocksInDoc when
 * running outside the normal editor context.
 */
async function expandLinkedBlocksForStitch(
  json: any,
  currentFileSource: string,
  filesByPath: Map<string, any>,
  schema: any,
  parseMarkdownFn: (markdown: string, schema: any) => any,
  depth: number = 0,
): Promise<any> {
  if (depth > 10) return json;

  if (json.type === 'linkedBlock') {
    const blockUid = json.attrs?.blockUid;
    const originalFile = json.attrs?.originalFile;
    if (!blockUid || !originalFile) return json;

    try {
      // Try to find the source file in our cache (by relative path or absolute path)
      // originalFile may have a leading '/' — strip it for relative path lookup
      const normalizedFile = originalFile.replace(/\\/g, '/').replace(/^\//, '');
      const sourceFile = filesByPath.get(originalFile) || filesByPath.get(normalizedFile);

      if (!sourceFile) {
        console.warn('[voiden-stitch] Could not find linked block source:', originalFile);
        return json;
      }

      // Read the source file content
      let content = sourceFile.content;
      if (!content) {
        content = await (window as any).electron?.files?.read?.(sourceFile.source);
      }
      if (!content) return json;

      // Parse using parseMarkdown with schema (same as BlockLink.tsx) to preserve UIDs
      const parsed = parseMarkdownFn(content, schema);
      if (!parsed?.content) return json;

      // Find the block with matching UID in the parsed document
      const foundBlock = findBlockByUid(parsed, blockUid);
      if (!foundBlock) {
        console.warn('[voiden-stitch] Block UID not found:', blockUid, 'in file:', originalFile);
        return json;
      }

      // Recursively expand any nested linked blocks
      const expanded = await expandLinkedBlocksForStitch(foundBlock, currentFileSource, filesByPath, schema, parseMarkdownFn, depth + 1);

      // Mark node and all children with importedFrom so deep merge works on json_body etc.
      const markImported = (node: any): any => ({
        ...node,
        attrs: { ...node.attrs, importedFrom: originalFile },
        ...(node.content && { content: node.content.map(markImported) }),
      });
      return markImported(expanded);
    } catch (err) {
      console.warn('[voiden-stitch] Error expanding linked block:', err);
      return json;
    }
  }

  // Recurse into content array
  if (json.content && Array.isArray(json.content)) {
    const expandedContent = await Promise.all(
      json.content.map((child: any) =>
        expandLinkedBlocksForStitch(child, currentFileSource, filesByPath, schema, parseMarkdownFn, depth + 1)
      )
    );
    return { ...json, content: expandedContent };
  }

  return json;
}

/** Find a block node by UID (recursive search through document JSON). */
function findBlockByUid(doc: any, uid: string): any | null {
  if (doc.attrs?.uid === uid) return doc;
  if (doc.content && Array.isArray(doc.content)) {
    for (const child of doc.content) {
      const found = findBlockByUid(child, uid);
      if (found) return found;
    }
  }
  return null;
}

/** Discover files matching config patterns without executing. Returns count. */
export async function discoverFiles(
  config: StitchConfig,
  currentFilePath: string,
): Promise<{ count: number; files: string[] }> {
  const allFiles: any[] = (await (window as any).electron?.files?.getVoidFiles?.()) || [];
  const projects = await (window as any).electron?.state?.getProjects?.();
  const projectPath = projects?.activeProject || '';

  const candidates = allFiles
    .filter((f: any) => f.source !== currentFilePath)
    .map((f: any) => ({
      source: f.source,
      relativePath: f.source.startsWith(projectPath)
        ? f.source.slice(projectPath.length + 1).replace(/\\/g, '/')
        : f.title,
    }));

  const matched = candidates.filter((f) => {
    const included = config.include.length === 0 || matchesAny(config.include, f.relativePath);
    const excluded = config.exclude.length > 0 && matchesAny(config.exclude, f.relativePath);
    return included && !excluded;
  });

  return {
    count: matched.length,
    files: matched.map((f) => f.relativePath).sort(),
  };
}
