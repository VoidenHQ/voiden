/**
 * Stitch Block Node
 *
 * TipTap atom node for defining a stitch (batch run) configuration.
 * Uses bg-surface styling, OAuth2-style key-value option rows,
 * folder picker for include patterns.
 */

import { mergeAttributes, Node, NodeViewProps } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Plus, X, ChevronDown, ChevronRight, Folder, FolderOpen, Loader } from 'lucide-react';
import type { StitchConfig } from '../lib/types';
import { stitchStore } from '../lib/stitchStore';
import { runStitch, discoverFiles } from '../lib/stitchEngine';

// Lazy-loaded accessor for the current file path
let getFilePath: (() => string | null) | null = null;
async function getCurrentFilePath(): Promise<string> {
  if (!getFilePath) {
    try {
      // @ts-ignore - Vite dynamic import
      const mod = await import(/* @vite-ignore */ '@/core/editors/voiden/VoidenEditor') as any;
      getFilePath = () => mod.useVoidenEditorStore?.getState?.()?.filePath ?? null;
    } catch {
      getFilePath = () => null;
    }
  }
  return getFilePath() || '';
}

// --- OAuth2-style row classes (matching voiden-advanced-auth) ---
const rowClass = "flex hover:bg-muted/50 transition-colors";
const keyCellClass = "p-1 px-2 h-6 flex items-center text-sm font-mono text-comment whitespace-nowrap border-r border-border shrink-0";
const valueCellClass = "p-1 px-2 h-6 flex items-center text-sm font-mono text-text w-full min-w-0 justify-end";

export function createStitchNode(
  NodeViewWrapper: any,
  RequestBlockHeader: any,
  useActiveEnv: () => Record<string, string> | undefined,
  useEnvs: () => { data?: { activeEnv: string | null; data: Record<string, Record<string, string>>; displayNames: Record<string, string> } },
  openResultsTab: () => void,
) {
  const StitchNodeView = (props: NodeViewProps) => {
    const { node, updateAttributes, editor } = props;
    const isEditable = editor.isEditable;
    const activeEnv = useActiveEnv();
    const { data: envData } = useEnvs();

    // Parse attributes
    const include: string[] = useMemo(() => {
      try { return JSON.parse(node.attrs.include || '[]'); }
      catch { return []; }
    }, [node.attrs.include]);

    const exclude: string[] = useMemo(() => {
      try { return JSON.parse(node.attrs.exclude || '[]'); }
      catch { return []; }
    }, [node.attrs.exclude]);

    const stopOnFailure = node.attrs.stopOnFailure === true || node.attrs.stopOnFailure === 'true';
    const isolateFiles = node.attrs.isolateFiles === true || node.attrs.isolateFiles === 'true';
    const delayBetweenFiles = parseInt(node.attrs.delayBetweenFiles || '0', 10) || 0;
    const environment = node.attrs.environment || '';

    // Local state
    const [matchedCount, setMatchedCount] = useState<number | null>(null);
    const [matchedFiles, setMatchedFiles] = useState<string[]>([]);
    const [showFiles, setShowFiles] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const runningRef = useRef(false); // track if THIS block started the run
    const abortRef = useRef<AbortController | null>(null);

    // Discover matched files when patterns change
    useEffect(() => {
      let cancelled = false;
      const config: StitchConfig = { include, exclude, stopOnFailure, delayBetweenFiles, isolateFiles, environment };

      getCurrentFilePath().then((currentFilePath) => {
        return discoverFiles(config, currentFilePath);
      }).then((result) => {
        if (!cancelled) {
          setMatchedCount(result.count);
          setMatchedFiles(result.files);
        }
      });

      return () => { cancelled = true; };
    }, [include, exclude, editor]);

    // Pattern management
    const addPattern = useCallback((type: 'include' | 'exclude') => {
      const current = type === 'include' ? include : exclude;
      const updated = [...current, ''];
      updateAttributes({ [type]: JSON.stringify(updated) });
    }, [include, exclude, updateAttributes]);

    const updatePattern = useCallback((type: 'include' | 'exclude', index: number, value: string) => {
      const current = type === 'include' ? [...include] : [...exclude];
      current[index] = value;
      updateAttributes({ [type]: JSON.stringify(current) });
    }, [include, exclude, updateAttributes]);

    const removePattern = useCallback((type: 'include' | 'exclude', index: number) => {
      const current = type === 'include' ? [...include] : [...exclude];
      current.splice(index, 1);
      updateAttributes({ [type]: JSON.stringify(current) });
    }, [include, exclude, updateAttributes]);

    // Folder picker — opens native dialog, converts to relative glob
    const handlePickFolder = useCallback(async () => {
      try {
        const projects = await (window as any).electron?.state?.getProjects?.();
        const projectPath = projects?.activeProject;
        if (!projectPath) return;

        const [selectedPath] = (await (window as any).electron?.dialog?.openFile?.({
          defaultPath: projectPath,
          properties: ['openDirectory'],
        })) ?? [];

        if (!selectedPath) return;

        // Convert absolute path to project-relative glob
        let relativePath = selectedPath;
        if (selectedPath.startsWith(projectPath)) {
          relativePath = selectedPath.slice(projectPath.length + 1).replace(/\\/g, '/');
        }
        // Add /**/*.void to include all void files recursively
        const pattern = relativePath ? `${relativePath}/**/*.void` : '**/*.void';

        const updated = [...include, pattern];
        updateAttributes({ include: JSON.stringify(updated) });
      } catch (err) {
        console.error('[voiden-stitch] Folder picker failed:', err);
      }
    }, [include, updateAttributes]);

    // Run stitch
    const handleRun = useCallback(async () => {
      if (runningRef.current) return;

      const config: StitchConfig = { include, exclude, stopOnFailure, delayBetweenFiles, isolateFiles, environment };
      const currentFilePath = await getCurrentFilePath();

      abortRef.current = new AbortController();
      runningRef.current = true;
      setIsRunning(true);

      try {
        await runStitch(config, currentFilePath, {
          activeEnv,
          allEnvs: envData ? { data: envData.data } : undefined,
          openResultsTab,
          tabId: editor.storage.tabId,
        }, abortRef.current.signal);
      } catch (err) {
        console.error('[voiden-stitch] Run failed:', err);
      } finally {
        runningRef.current = false;
        setIsRunning(false);
        abortRef.current = null;
      }
    }, [include, exclude, stopOnFailure, delayBetweenFiles, isolateFiles, environment, editor, activeEnv, envData]);

    const handleCancel = useCallback(() => {
      if (!runningRef.current) return;
      abortRef.current?.abort();
    }, []);

    // Cmd+Enter to run when focus is inside the stitch block (e.g. in an input)
    const wrapperRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Only handle if focus is inside this stitch block's DOM
        if (!wrapperRef.current?.contains(document.activeElement)) return;

        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (!isRunning) handleRun();
        }
        if (e.key === 'Escape' && isRunning) {
          e.preventDefault();
          handleCancel();
        }
      };
      document.addEventListener('keydown', handleKeyDown, true);
      return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [isRunning, handleRun, handleCancel]);

    return (
      <NodeViewWrapper>
        <div
          ref={wrapperRef}
          className="my-2 border border-border rounded-lg overflow-hidden bg-surface"
          contentEditable={false}
          onMouseDown={(e) => {
            // Prevent TipTap from stealing focus / moving cursor when clicking inside the stitch block
            // but allow inputs/selects/buttons to receive focus normally
            const tag = (e.target as HTMLElement).tagName;
            if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON') {
              e.preventDefault();
            }
          }}
        >
          <RequestBlockHeader title="STITCH RUNNER" withBorder={false} editor={editor} />

          <div className="p-4 space-y-4">
            {/* Include patterns — with folder picker button */}
            <PatternSection
              label="Include"
              icon={<Folder size={12} className="text-comment" />}
              patterns={include}
              placeholder="e.g. api/**/*.void"
              emptyText="All .void files in project"
              isEditable={isEditable}
              onAdd={() => addPattern('include')}
              onUpdate={(i, v) => updatePattern('include', i, v)}
              onRemove={(i) => removePattern('include', i)}
              onPickFolder={handlePickFolder}
            />

            {/* Exclude patterns */}
            <PatternSection
              label="Exclude"
              icon={<X size={12} className="text-comment" />}
              patterns={exclude}
              placeholder="e.g. **/draft-*.void"
              emptyText="No exclusions"
              isEditable={isEditable}
              onAdd={() => addPattern('exclude')}
              onUpdate={(i, v) => updatePattern('exclude', i, v)}
              onRemove={(i) => removePattern('exclude', i)}
            />

            {/* Options — OAuth2-style key-value table */}
            <div className="border border-border rounded-md overflow-hidden">
              <div className={rowClass}>
                <div className={keyCellClass} style={{ width: 160 }}>Environment</div>
                <div className={valueCellClass}>
                  <select
                    value={environment}
                    onChange={(e) => updateAttributes({ environment: e.target.value })}
                    disabled={!isEditable}
                    className={`w-full bg-transparent text-sm font-mono text-text outline-none cursor-pointer${!isEditable ? ' opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <option value="">Active environment</option>
                    {envData && Object.keys(envData.data).map((envKey) => (
                      <option key={envKey} value={envKey}>
                        {envData.displayNames[envKey] || envKey.split('/').pop()?.replace(/\.env$/, '') || envKey}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={rowClass}>
                <div className={keyCellClass} style={{ width: 160 }}>Stop on failure</div>
                <div className={valueCellClass}>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={stopOnFailure}
                      onChange={(e) => updateAttributes({ stopOnFailure: e.target.checked })}
                      disabled={!isEditable}
                      className="rounded border-stone-700/50"
                    />
                    <span className="text-sm font-mono text-text">{stopOnFailure ? 'enabled' : 'disabled'}</span>
                  </label>
                </div>
              </div>
              <div className={rowClass}>
                <div className={keyCellClass} style={{ width: 160 }}>Isolate variables</div>
                <div className={valueCellClass}>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isolateFiles}
                      onChange={(e) => updateAttributes({ isolateFiles: e.target.checked })}
                      disabled={!isEditable}
                      className="rounded border-stone-700/50"
                    />
                    <span className="text-sm font-mono text-text">{isolateFiles ? 'enabled' : 'disabled'}</span>
                  </label>
                </div>
              </div>
              <div className={rowClass}>
                <div className={keyCellClass} style={{ width: 160 }}>Delay between files</div>
                <div className={valueCellClass}>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={delayBetweenFiles}
                    onChange={(e) => updateAttributes({ delayBetweenFiles: parseInt(e.target.value) || 0 })}
                    disabled={!isEditable}
                    className={`w-16 bg-transparent text-sm font-mono text-text outline-none text-right${!isEditable ? ' opacity-50 cursor-not-allowed' : ''}`}
                  />
                  <span className="text-sm font-mono text-comment ml-1">ms</span>
                </div>
              </div>
            </div>

            {/* Footer — file count + play button */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowFiles(!showFiles)}
                className="flex items-center gap-1.5 text-[11px] text-comment hover:text-text transition-colors"
                style={{ cursor: 'pointer' }}
              >
                <FileIcon />
                {matchedCount !== null
                  ? `${matchedCount} file${matchedCount !== 1 ? 's' : ''} matched`
                  : 'Scanning...'
                }
                {matchedCount !== null && matchedCount > 0 && (
                  showFiles ? <ChevronDown size={10} /> : <ChevronRight size={10} />
                )}
              </button>

              <button
                onMouseDown={(e) => {
                  // Prevent TipTap from moving cursor / triggering selection
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isRunning) {
                    handleCancel();
                  } else {
                    handleRun();
                  }
                }}
                disabled={!isRunning && (!matchedCount || matchedCount === 0)}
                className="p-1.5 rounded hover:bg-active transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title={isRunning ? 'Cancel (Esc)' : 'Run Stitch (⌘↵)'}
                style={{
                  cursor: (!isRunning && (!matchedCount || matchedCount === 0)) ? 'not-allowed' : 'pointer',
                  color: isRunning ? undefined : 'var(--icon-success)',
                }}
              >
                {isRunning ? <Loader className="animate-spin" size={16} /> : <Play size={16} />}
              </button>
            </div>

            {/* Matched files preview */}
            {showFiles && matchedFiles.length > 0 && (
              <div className="border border-border rounded-md bg-editor p-2 max-h-32 overflow-y-auto">
                {matchedFiles.map((f, i) => (
                  <div key={i} className="text-[10px] text-comment font-mono py-0.5 truncate flex items-center gap-1.5">
                    <FileIcon />
                    {f}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </NodeViewWrapper>
    );
  };

  /** Small file icon. */
  const FileIcon = () => (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 opacity-50">
      <path d="M4 1h5.5L14 5.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 1v5h5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );

  /** Pattern section with optional folder picker. */
  const PatternSection = ({
    label,
    icon,
    patterns,
    placeholder,
    emptyText,
    isEditable,
    onAdd,
    onUpdate,
    onRemove,
    onPickFolder,
  }: {
    label: string;
    icon: React.ReactNode;
    patterns: string[];
    placeholder: string;
    emptyText: string;
    isEditable: boolean;
    onAdd: () => void;
    onUpdate: (index: number, value: string) => void;
    onRemove: (index: number) => void;
    onPickFolder?: () => void;
  }) => (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-[11px] text-comment font-semibold uppercase tracking-wide">{label}</span>
        </div>
        {isEditable && (
          <div className="flex items-center gap-1">
            {onPickFolder && (
              <button
                onClick={onPickFolder}
                className="text-comment hover:text-accent transition-colors p-0.5 rounded"
                title="Browse for folder"
                style={{ cursor: 'pointer' }}
              >
                <FolderOpen size={12} />
              </button>
            )}
            <button
              onClick={onAdd}
              className="text-comment hover:text-accent transition-colors p-0.5 rounded"
              title={`Add ${label.toLowerCase()} pattern`}
              style={{ cursor: 'pointer' }}
            >
              <Plus size={12} />
            </button>
          </div>
        )}
      </div>
      {patterns.length === 0 ? (
        <div className="text-[10px] text-comment italic px-1">{emptyText}</div>
      ) : (
        <div className="space-y-1">
          {patterns.map((pattern, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="text"
                value={pattern}
                onChange={(e) => onUpdate(i, e.target.value)}
                placeholder={placeholder}
                disabled={!isEditable}
                className="flex-1 px-2 py-1 bg-editor border border-border rounded-md text-text text-[11px] font-mono focus:outline-none focus:border-accent placeholder:text-comment/40"
              />
              {isEditable && (
                <button
                  onClick={() => onRemove(i)}
                  className="text-comment hover:text-red-400 transition-colors p-0.5 rounded"
                  style={{ cursor: 'pointer' }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // TipTap Node definition
  return Node.create({
    name: 'stitch',
    group: 'block',
    content: '',
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        include: {
          default: JSON.stringify(['**/*.void']),
          parseHTML: (el: HTMLElement) => el.getAttribute('data-include') || JSON.stringify(['**/*.void']),
          renderHTML: (attrs: any) => ({ 'data-include': attrs.include }),
        },
        exclude: {
          default: JSON.stringify([]),
          parseHTML: (el: HTMLElement) => el.getAttribute('data-exclude') || JSON.stringify([]),
          renderHTML: (attrs: any) => ({ 'data-exclude': attrs.exclude }),
        },
        stopOnFailure: {
          default: false,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-stop-on-failure') === 'true',
          renderHTML: (attrs: any) => ({ 'data-stop-on-failure': String(attrs.stopOnFailure) }),
        },
        delayBetweenFiles: {
          default: 0,
          parseHTML: (el: HTMLElement) => parseInt(el.getAttribute('data-delay') || '0', 10),
          renderHTML: (attrs: any) => ({ 'data-delay': String(attrs.delayBetweenFiles) }),
        },
        isolateFiles: {
          default: false,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-isolate-files') === 'true',
          renderHTML: (attrs: any) => ({ 'data-isolate-files': String(attrs.isolateFiles) }),
        },
        environment: {
          default: '',
          parseHTML: (el: HTMLElement) => el.getAttribute('data-environment') || '',
          renderHTML: (attrs: any) => ({ 'data-environment': attrs.environment }),
        },
      };
    },

    parseHTML() {
      return [{ tag: 'stitch' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['stitch', mergeAttributes(HTMLAttributes)];
    },

    addNodeView() {
      return ReactNodeViewRenderer(StitchNodeView);
    },
  });
}
