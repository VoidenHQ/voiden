import React, { forwardRef, startTransition, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { MatchedFragment, highlightText } from "./MatchedFragment";
import { Editor, JSONContent, Node, NodeViewProps, Range, mergeAttributes } from "@tiptap/core";
import { EditorState, PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import tippy from "tippy.js";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, useEditor } from "@tiptap/react";
import { ArrowRight, Plus, File, Folder, ChevronRight, Box, CheckSquare, Square } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { getQueryClient } from "@/main";
import { useGetApyFiles } from "@/core/documents/hooks";
import { proseClasses, useVoidenExtensionsAndSchema } from "@/core/editors/voiden/VoidenEditor";
import { useBlockContentStore } from "@/core/stores/blockContentStore";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useElectronEvent } from "@/core/providers";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getLinkableNodeTypes, getNodeDisplayName } from "@/plugins";

/**
 * TYPES & INTERFACES
 */
export interface FileLinkItem {
  filePath: string;
  filename: string;
  isNew?: boolean;
  isExternal?: boolean;
  pmJSON?: JSONContent;
  pathFragments?: MatchedFragment[];
  filenameFragments?: MatchedFragment[];
}

export interface FileLinkListProps {
  items: FileLinkItem[];
  command: (item: FileLinkItem | { block: JSONContent; originalFile: string }) => void;
  query: string;
}

/**
 * PURE DATA TRANSFORMATION FUNCTIONS
 */

/**
 * Truncates a folder path intelligently for display.
 * Shows first segment + ... + last N segments to fit within maxLength.
 * Example: "projects/very/deeply/nested/folder/path" -> "projects/.../folder/path"
 */
function truncatePath(path: string, maxLength: number = 40): string {
  if (!path || path.length <= maxLength) return path;

  const segments = path.split("/");
  if (segments.length <= 2) return path; // Can't truncate meaningfully

  const first = segments[0];
  const ellipsis = "...";

  // Start with last segment and keep adding until we exceed maxLength
  const endSegments: string[] = [];
  let currentLength = first.length + ellipsis.length + 2; // +2 for slashes

  for (let i = segments.length - 1; i > 0; i--) {
    const segmentLength = segments[i].length + 1; // +1 for slash
    if (currentLength + segmentLength > maxLength && endSegments.length > 0) {
      break;
    }
    endSegments.unshift(segments[i]);
    currentLength += segmentLength;
  }

  // If we included all segments after first, no need for ellipsis
  if (endSegments.length === segments.length - 1) {
    return path;
  }

  return `${first}/${ellipsis}/${endSegments.join("/")}`;
}

export function extractVoidenBlocks(pmJSON: JSONContent): JSONContent[] {
  if (!pmJSON?.content || !Array.isArray(pmJSON.content)) return [];

  const linkableNodeTypes = getLinkableNodeTypes();

  const blocks = pmJSON.content.filter((node: JSONContent) => {
    if (node.type === "linkedBlock") return false;
    return linkableNodeTypes.includes(node.type || '');
  });

  return blocks;
}

/**
 * A section group containing a label and the blocks that belong to it.
 * Used to render grouped block lists in the @ import picker.
 */
export interface BlockSection {
  label: string;
  blocks: JSONContent[];
}

/**
 * Extracts section labels and indices from a .void file with request-separator nodes.
 * Used to present section-level import options in the @ picker for multi-section files.
 * Section 0 = content after the first separator (or the whole content if no separator).
 */
export function extractAllSections(pmJSON: JSONContent): Array<{ label: string; sectionUid: string; blocks: JSONContent[] }> {
  if (!pmJSON?.content || !Array.isArray(pmJSON.content)) return [];

  const linkableNodeTypes = getLinkableNodeTypes();
  const result: Array<{ label: string; sectionUid: string; blocks: JSONContent[] }> = [];
  let currentLabel = "Request";
  let currentUid: string | null = null;
  let currentBlocks: JSONContent[] = [];
  let currentHasLinkedFile = false;
  let isFirstNode = true;

  for (const node of pmJSON.content) {
    if (node.type === "request-separator") {
      if (!isFirstNode && currentUid && !currentHasLinkedFile) {
        result.push({ label: currentLabel, sectionUid: currentUid, blocks: currentBlocks });
      }
      currentBlocks = [];
      currentHasLinkedFile = false;
      isFirstNode = false;
      currentLabel = node.attrs?.label || "Request";
      currentUid = node.attrs?.uid ?? null;
    } else {
      isFirstNode = false;
      if (node.type === "linkedFile") {
        currentHasLinkedFile = true;
      } else if (node.type !== "linkedBlock" && linkableNodeTypes.includes(node.type || '')) {
        currentBlocks.push(node);
      }
    }
  }

  if (currentUid && !currentHasLinkedFile) {
    result.push({ label: currentLabel, sectionUid: currentUid, blocks: currentBlocks });
  }

  return result;
}

/**
 * Groups blocks by request sections using request-separator nodes as dividers.
 * Returns an array of sections, each with a label and its child blocks.
 */
export function extractGroupedBlocks(pmJSON: JSONContent): BlockSection[] {
  if (!pmJSON?.content || !Array.isArray(pmJSON.content)) return [];

  const linkableNodeTypes = getLinkableNodeTypes();
  const sections: BlockSection[] = [];
  let currentLabel = "Request 1";
  let currentBlocks: JSONContent[] = [];
  let sectionCount = 1;

  for (const node of pmJSON.content) {
    if (node.type === "request-separator") {
      // Finish current section if it has blocks
      if (currentBlocks.length > 0) {
        sections.push({ label: currentLabel, blocks: currentBlocks });
      }
      sectionCount++;
      currentLabel = node.attrs?.label || `Request ${sectionCount}`;
      currentBlocks = [];
      continue;
    }

    if (node.type === "linkedBlock") continue;
    if (!linkableNodeTypes.includes(node.type || '')) continue;

    currentBlocks.push(node);
  }

  // Push the last section
  if (currentBlocks.length > 0) {
    sections.push({ label: currentLabel, blocks: currentBlocks });
  }

  return sections;
}

const getActiveProject = () => {
  const queryClient = getQueryClient();
  const projects = queryClient.getQueryData<{
    projects: { path: string; name: string }[];
    activeProject: string;
  }>(["projects"]);
  return projects?.activeProject;
};
// Recursively extract file links from a file tree.
export function getFileLinks(node: JSONContent, activeProject: string): FileLinkItem[] {
  let fileLinks: FileLinkItem[] = [];
  if (node.type === "file") {
    // Normalize path separators to forward slashes for consistent handling across platforms
    const normalizedPath = node.path.replace(/\\/g, "/");
    const normalizedActiveProject = activeProject.replace(/\\/g, "/");
    const relativePath = normalizedPath.replace(normalizedActiveProject, "");
    const filename = normalizedPath.split("/").pop();
    if (filename) fileLinks.push({ filePath: relativePath, filename });
  } else if (node.type === "folder" && Array.isArray(node.children)) {
    node.children.forEach((child: JSONContent) => {
      fileLinks = fileLinks.concat(getFileLinks(child, activeProject));
    });
  }
  return fileLinks;
}

/**
 * SIDE-EFFECT / DOMAIN FUNCTIONS
 */

// Opens a file using the Electron IPC mechanism.
export async function openFile(filePath: string, filename: string) {
  const queryClient = getQueryClient();
  try {
    await window.electron?.ipc.invoke("fileLink:open", filePath, filename);
  } catch (err) {

  } finally {
    queryClient.invalidateQueries({ queryKey: ["panel:tabs", "main"] });
    queryClient.invalidateQueries({ queryKey: ["tab:content", "main", filename] });
  }
}

// Compute an absolute path from the file node and active project.
export async function computeAbsolutePath(nodeAttrs: FileLinkItem) {
  const { filePath, isExternal } = nodeAttrs;
  let absolutePath = filePath;
  if (!isExternal) {
    const queryClient = getQueryClient();
    const projects = queryClient.getQueryData<{
      projects: { path: string; name: string }[];
      activeProject: string;
    }>(["projects"]);
    const activeProject = projects?.activeProject;
    if (!activeProject) {

      return;
    }
    absolutePath = (await window.electron?.utils.pathJoin(activeProject, filePath)) ?? "";
  }
  return absolutePath;
}

/**
 * UI COMPONENTS
 */

// Read-only preview of a block. Uses `inert` to prevent any element inside
// (CodeMirror, contentEditable, etc.) from ever receiving focus.
export function BlockPreviewEditor({ block }: { block: JSONContent }) {
  const { finalExtensions } = useVoidenExtensionsAndSchema();

  const previewExtensions = useMemo(
    () => finalExtensions.filter(ext => ext?.name !== 'seamlessNavigation'),
    [finalExtensions]
  );

  const editor = useEditor(
    {
      content: block ? { type: "doc", content: [block] } : "",
      extensions: previewExtensions,
      editorProps: { attributes: { class: proseClasses } },
      editable: false,
    },
    [block, previewExtensions],
  );

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  return (
    <div className="w-full pointer-events-none select-none" inert="">
      <EditorContent editor={editor} />
    </div>
  );
}

const FileLinkTippyContent = forwardRef((props: FileLinkListProps & { editor?: Editor }, ref) => {
  const { command, editor: parentEditor } = props;
  const [selectedFile, setSelectedFile] = useState<FileLinkItem | null>(null);
  const { data: voidenFiles } = useGetApyFiles();
  const [listSelectedIndex, setListSelectedIndex] = useState(0);
  const [isBlockMode, setIsBlockMode] = useState(false);
  const [multiSelectedItems, setMultiSelectedItems] = useState<(FileLinkItem | JSONContent)[]>([]);

  // Accumulated file corpus — grows as server returns results for each query.
  // Never shrinks so previously found files remain filterable client-side.
  const queryClient = useQueryClient();
  const activeDir = queryClient.getQueryData<{ activeDirectory: string }>(["app:state"])?.activeDirectory;
  const activeProject = (queryClient.getQueryData<{ activeProject: string }>(["projects"]) as any)?.activeProject || "";

  const [scoredLinks, setScoredLinks] = useState<FileLinkItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // Server fetch — keyed on debounced query; scoring runs once per response
  // using the query the IPC was issued for, producing the ranked list directly.
  const [debouncedQuery, setDebouncedQuery] = useState(props.query);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(props.query), 150);
    return () => clearTimeout(t);
  }, [props.query]);

  // Session id per picker instance — main-process cache reloads on change.
  // Close the session on unmount so the server can release its cached paths.
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  useEffect(() => {
    const sessionId = sessionIdRef.current;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.electron?.files as any)?.flatListCloseSession?.(sessionId);
    };
  }, []);

  useEffect(() => {
    if (!activeDir) return;
    let cancelled = false;
    setIsLoadingFiles(true);
    const currentSource = parentEditor?.storage?.source as string | undefined;
    const currentRelPath = currentSource
      ? (currentSource.startsWith(activeProject) ? currentSource.slice(activeProject.length).replace(/^[/\\]/, "") : currentSource)
      : undefined;
    const slashIdx = currentRelPath ? currentRelPath.lastIndexOf("/") : -1;
    const currentDir = slashIdx > 0 ? currentRelPath!.slice(0, slashIdx) : undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.electron?.files as any)
        ?.flatList?.(activeDir, sessionIdRef.current, debouncedQuery || undefined, currentDir)
        .then((list: {
          name: string;
          path: string;
          pathFragments?: MatchedFragment[];
          filenameFragments?: MatchedFragment[];
        }[]) => {
        if (cancelled || !list) return;
          setIsLoadingFiles(false);
          // Server returns already-scored-and-sorted results with fragments attached.
          const ranked: FileLinkItem[] = list.map((f) => {
            const rel = f.path.startsWith(activeProject)
                ? f.path.slice(activeProject.length).replace(/^[/\\]/, "")
                : f.path;
            return {
              filePath: rel,
              filename: f.name,
              pathFragments: f.pathFragments,
              filenameFragments: f.filenameFragments,
            };
          });
          startTransition(() => setScoredLinks(ranked));
        });
    return () => {
      cancelled = true;
    };
  }, [activeDir, debouncedQuery, activeProject]);

  // Strip the current file from suggestions — cheap filter, no rescoring.
  const allFileLinks = useMemo((): FileLinkItem[] => {
    const currentSource = parentEditor?.storage?.source as string | undefined;
    const currentRelPath = currentSource
      ? (currentSource.startsWith(activeProject)
          ? currentSource.slice(activeProject.length).replace(/^[/\\]/, "")
          : currentSource)
      : null;
    return currentRelPath ? scoredLinks.filter((f) => f.filePath !== currentRelPath) : scoredLinks;
  }, [scoredLinks, parentEditor, activeProject]);
  
  // Use refs map to track all items
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainer = useRef<HTMLDivElement>(null);
  const blockScrollContainer = useRef<HTMLDivElement>(null);

  // Reset list selection, multi-selection, and mode when query changes
  useEffect(() => {
    setListSelectedIndex(0);
    setMultiSelectedItems([]);
    setIsBlockMode(false);
    setSelectedFile(null);
  }, [props.query]);

  // Grouped sections for block mode rendering
  const groupedSections = useMemo(() => {
    if (!isBlockMode || !selectedFile?.pmJSON) return [];
    try {
      return extractGroupedBlocks(selectedFile.pmJSON);
    } catch {
      return [];
    }
  }, [isBlockMode, selectedFile]);

  // Flat list of selectable items for keyboard navigation
  // Each entry is a "whole file" import option, a linked-section option, a section header, or a block
  type FlatBlockItem = { kind: "file"; flatIndex: number }
                     | { kind: "linked-section"; sectionUid: string; label: string; flatIndex: number }
                     | { kind: "section"; section: BlockSection; flatIndex: number }
                     | { kind: "block"; block: JSONContent; sectionLabel: string; flatIndex: number };

  const flatBlockItems = useMemo((): FlatBlockItem[] => {
    const items: FlatBlockItem[] = [];
    const hasSeparators = selectedFile?.pmJSON?.content?.some(
      (n: any) => n.type === "request-separator"
    ) ?? false;

    if (hasSeparators) {
      // Multi-section file: show each section as an importable header + its individual blocks
      const allSections = extractAllSections(selectedFile!.pmJSON!);
      for (const sec of allSections) {
        items.push({ kind: "linked-section", sectionUid: sec.sectionUid, label: sec.label, flatIndex: items.length });
        for (const block of sec.blocks) {
          items.push({ kind: "block", block, sectionLabel: sec.label, flatIndex: items.length });
        }
      }
    } else {
      // No separators: offer whole-file import (unless the file itself contains a linkedFile
      // block — importing it would leave the nested reference unexpanded)
      const fileHasLinkedFile = selectedFile?.pmJSON?.content?.some(
        (n: any) => n.type === "linkedFile"
      ) ?? false;
      if (!fileHasLinkedFile) items.push({ kind: "file", flatIndex: 0 });
      const singleSection = groupedSections.length === 1;
      for (const section of groupedSections) {
        const displaySection = singleSection ? { ...section, label: "Request" } : section;
        items.push({ kind: "section", section: displaySection, flatIndex: items.length });
        for (const block of section.blocks) {
          items.push({ kind: "block", block, sectionLabel: displaySection.label, flatIndex: items.length });
        }
      }
    }
    return items;
  }, [groupedSections, selectedFile]);

  const currentItems = useMemo(() => {
    if (isBlockMode) {
      if (!selectedFile?.pmJSON) return [];
      try {
        return extractVoidenBlocks(selectedFile.pmJSON);
      } catch {
        return [];
      }
    } else {
      return allFileLinks;
    }
  }, [isBlockMode, allFileLinks, selectedFile]);

  const filteredItems = useMemo(() => {
    // allFileLinks is already client-filtered; block mode shows all blocks as-is.
    return currentItems;
  }, [currentItems]);

  const selectedBlock = useMemo(() => {
    if (isBlockMode && selectedFile && filteredItems.length > 0) {
      const item = filteredItems[listSelectedIndex] as JSONContent;
      return item;
    }
    return null;
  }, [isBlockMode, selectedFile, filteredItems, listSelectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      // Arrow Up/Down navigation — use flatBlockItems length in block mode
      const navLength = isBlockMode ? flatBlockItems.length : filteredItems.length;
      if (event.key === "ArrowUp") {
        if (navLength <= 0) return false;
        setListSelectedIndex((prev) => (prev - 1 + navLength) % navLength);
        return true;
      }
      if (event.key === "ArrowDown") {
        if (navLength <= 0) return false;
        setListSelectedIndex((prev) => (prev + 1) % navLength);
        return true;
      }

      // Arrow Left: Go back to file mode (if currently in block mode suggestions)
      if (event.key === "ArrowLeft") {
        if (!isBlockMode) return false;
        setIsBlockMode(false);
        setSelectedFile(null);
        setListSelectedIndex(0);
        return true;
      }

      // Arrow Right or Space: Expand to block mode (if in file mode)
      if ((event.key === "ArrowRight" || event.key === " ") && !isBlockMode) {
        const currentItem = filteredItems[listSelectedIndex] as FileLinkItem;
        if (!currentItem || currentItem.isNew || !voidenFiles) {
          return false; // allow editor to handle the arrow key normally
        }

        // Find the file with pmJSON data
        // Try matching by filename since paths might be in different formats (relative vs absolute)
        const fileWithData = voidenFiles.find((f: any) => {
          const normalizedItemPath = currentItem.filePath.replace(/\\/g, "/");
          const normalizedFilePath = f.filePath?.replace(/\\/g, "/") || "";

          return (
            f.filename === currentItem.filename ||
            normalizedFilePath === normalizedItemPath ||
            normalizedFilePath.endsWith(normalizedItemPath)
          );
        });

        if (fileWithData) {
          setSelectedFile(fileWithData);
          setIsBlockMode(true);
          setListSelectedIndex(0);
          return true; // consume event since we're transitioning to block mode
        }

        return false; // file not found with blocks, let editor handle arrow key
      }

      // Shift+Enter: Multi-selection
      if (event.key === "Enter" && event.shiftKey && !event.repeat) {
        if (isBlockMode) {
          const flatItem = flatBlockItems[listSelectedIndex];
          if (!flatItem) return true;

          // For section headers, toggle all blocks in the section
          if (flatItem.kind === "section") {
            const sectionBlocks = flatItem.section.blocks;
            const allSelected = sectionBlocks.every((block) =>
              multiSelectedItems.some((sel) => (sel as JSONContent)?.attrs?.uid === block?.attrs?.uid)
            );
            if (allSelected) {
              const sectionUids = new Set(sectionBlocks.map((b) => b.attrs?.uid));
              setMultiSelectedItems((prev) =>
                prev.filter((item) => !sectionUids.has((item as JSONContent)?.attrs?.uid))
              );
            } else {
              setMultiSelectedItems((prev) => {
                const existingUids = new Set(prev.map((item) => (item as JSONContent)?.attrs?.uid));
                const newBlocks = sectionBlocks.filter((b) => !existingUids.has(b.attrs?.uid));
                return [...prev, ...newBlocks];
              });
            }
            return true;
          }

          // For individual blocks
          const blockItem = flatItem.block;
          const isSelected = multiSelectedItems.some((item) => {
            const jsonItem = item as JSONContent;
            return jsonItem?.attrs?.uid === blockItem?.attrs?.uid;
          });

          if (isSelected) {
            setMultiSelectedItems((prev) =>
              prev.filter((item) => {
                const jsonItem = item as JSONContent;
                return jsonItem?.attrs?.uid !== blockItem?.attrs?.uid;
              }),
            );
          } else {
            setMultiSelectedItems((prev) => [...prev, blockItem]);
          }
        } else {
          const fileItem = currentItem as FileLinkItem;
          const isSelected = multiSelectedItems.some((item) => {
            const linkItem = item as FileLinkItem;
            return linkItem.filePath === fileItem.filePath;
          });

          if (isSelected) {
            setMultiSelectedItems((prev) =>
              prev.filter((item) => {
                const linkItem = item as FileLinkItem;
                return linkItem.filePath !== fileItem.filePath;
              }),
            );
          } else {
            setMultiSelectedItems((prev) => [...prev, fileItem]);
          }
        }
        return true;
      }

      // Enter: Insert selected item(s)
      if (event.key === "Enter") {
        if (multiSelectedItems.length > 0) {
          if (isBlockMode && selectedFile) {
            const blocksToInsert = multiSelectedItems.map((item) => ({
              block: item as JSONContent,
              originalFile: selectedFile.filePath
            }));
            command(blocksToInsert as any);
          } else {
            command(multiSelectedItems as any);
          }
          setMultiSelectedItems([]);
        } else if (isBlockMode && selectedFile) {
          // Check if we're selecting the whole-file import, a section header, or a block
          const flatItem = flatBlockItems[listSelectedIndex];
          if (flatItem?.kind === "file") {
            command({ importFile: selectedFile.filePath } as any);
          } else if (flatItem?.kind === "linked-section") {
            command({ importFile: selectedFile.filePath, sectionUid: flatItem.sectionUid, sectionLabel: flatItem.label } as any);
          } else if (flatItem?.kind === "section") {
            // Insert all blocks in the section
            const blocksToInsert = flatItem.section.blocks.map((block) => ({
              block,
              originalFile: selectedFile.filePath,
            }));
            command(blocksToInsert as any);
          } else if (flatItem?.kind === "block") {
            command({ block: flatItem.block, originalFile: selectedFile.filePath });
          }
        } else {
          const selectedItem = filteredItems[listSelectedIndex];
          command(selectedItem as FileLinkItem);
        }
        return true;
      }
      return false;
    },
  }));

  // FIXED: Improved smooth scroll behavior with padding
  useEffect(() => {
    const activeItem = itemRefs.current.get(listSelectedIndex);
    const container = isBlockMode ? blockScrollContainer.current : scrollContainer.current;

    if (activeItem && container) {
      const padding = 32; // Extra padding to ensure item is fully visible
      const itemTop = activeItem.offsetTop;
      const itemBottom = itemTop + activeItem.offsetHeight;
      const containerScrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;

      // Item is below visible area - scroll down
      if (itemBottom + padding > containerScrollTop + containerHeight) {
        container.scrollTo({
          top: itemBottom + padding - containerHeight,
        });
      }
      // Item is above visible area - scroll up
      else if (itemTop - padding < containerScrollTop) {
        container.scrollTo({
          top: itemTop - padding,
        });
      }
    }
  }, [listSelectedIndex, isBlockMode]);

  // Helper to set item ref
  const setItemRef = (index: number) => (el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(index, el);
    } else {
      itemRefs.current.delete(index);
    }
  };

  // Get the currently selected flat item for preview
  const selectedFlatItem = flatBlockItems[listSelectedIndex] || null;
  const previewBlock = selectedFlatItem?.kind === "block"
    ? selectedFlatItem.block
    : selectedFlatItem?.kind === "section"
      ? selectedFlatItem.section.blocks[0] || null
      : null;

  // Helper: insert a section (all its blocks)
  const insertSection = (section: BlockSection) => {
    const blocksToInsert = section.blocks.map((block) => ({
      block,
      originalFile: selectedFile!.filePath,
    }));
    command(blocksToInsert as any);
  };

  // Helper: insert a single block
  const insertBlock = (block: JSONContent) => {
    command({ block, originalFile: selectedFile!.filePath });
  };

  // RENDERING: Block mode with preview panel
  if (isBlockMode && selectedFile) {
    return (
      <div
        className="w-[720px] bg-panel border border-border rounded-lg shadow-lg text-text text-sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => parentEditor?.view.focus()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg">
          <File className="text-accent" size={16} />
          <span className="font-medium text-text">{selectedFile.filename}</span>
          <ChevronRight className="text-comment" size={14} />
          <span className="text-comment text-xs">Blocks</span>
        </div>

        {/* Content */}
        <div className="flex h-full max-h-[400px]">
          {/* Block List */}
          <div
            ref={blockScrollContainer}
            className="flex-none w-48 border-r border-border overflow-y-auto"
          >
            {flatBlockItems.length > 0 ? (
              flatBlockItems.map((flatItem, index) => {
                if (flatItem.kind === "file") {
                  const isSelected = index === listSelectedIndex;
                  return (
                    <div
                      key="import-file"
                      ref={setItemRef(index)}
                      onClick={() => {
                        setListSelectedIndex(index);
                        if (isSelected) command({ importFile: selectedFile!.filePath } as any);
                      }}
                      className={cn(
                        "px-3 py-2 cursor-pointer transition-colors border-l-2 border-transparent border-b border-border",
                        "hover:bg-active/50",
                        isSelected && "bg-active border-l-accent",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <ArrowRight className="text-accent flex-shrink-0" size={13} />
                        <span className="text-xs font-semibold text-accent">Import entire file</span>
                      </div>
                    </div>
                  );
                }

                if (flatItem.kind === "linked-section") {
                  const isSelected = index === listSelectedIndex;
                  return (
                    <div
                      key={`linked-section-${flatItem.sectionUid}`}
                      ref={setItemRef(index)}
                      onClick={() => {
                        setListSelectedIndex(index);
                        if (isSelected) command({ importFile: selectedFile!.filePath, sectionUid: flatItem.sectionUid, sectionLabel: flatItem.label } as any);
                      }}
                      className={cn(
                        "px-3 py-2 cursor-pointer transition-colors border-l-2 border-transparent",
                        "hover:bg-active/50",
                        isSelected && "bg-active border-l-accent",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <ArrowRight className="text-accent flex-shrink-0" size={13} />
                        <span className="text-xs font-semibold text-accent truncate">{flatItem.label}</span>
                      </div>
                    </div>
                  );
                }

                if (flatItem.kind === "section") {
                  const section = flatItem.section;
                  const isSelected = index === listSelectedIndex;
                  return (
                    <div
                      key={`section-${section.label}-${index}`}
                      ref={setItemRef(index)}
                      onClick={() => {
                        setListSelectedIndex(index);
                        if (isSelected) {
                          insertSection(section);
                        }
                      }}
                      className={cn(
                        "px-3 py-2 cursor-pointer transition-colors border-l-2 border-transparent",
                        "hover:bg-active/50",
                        isSelected && "bg-active border-l-accent",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold tracking-wide uppercase text-accent opacity-70 truncate">
                          {section.label}
                        </span>
                        <span className="text-[9px] text-comment ml-auto flex-shrink-0">
                          {section.blocks.length}
                        </span>
                      </div>
                    </div>
                  );
                }

                const blockItem = flatItem.block;
                const isSelected = index === listSelectedIndex;
                const isMultiSelected = multiSelectedItems.some((sel) => {
                  const selBlock = sel as JSONContent;
                  return selBlock?.attrs?.uid === blockItem?.attrs?.uid;
                });

                return (
                  <div
                    key={blockItem.attrs?.uid || `${blockItem.type}-${index}`}
                    ref={setItemRef(index)}
                    onClick={() => {
                      setListSelectedIndex(index);
                      if (isSelected) {
                        if (multiSelectedItems.length > 0) {
                          const blocksToInsert = multiSelectedItems.map((item) => ({
                            block: item as JSONContent,
                            originalFile: selectedFile.filePath,
                          }));
                          command(blocksToInsert as any);
                          setMultiSelectedItems([]);
                        } else {
                          insertBlock(blockItem);
                        }
                      }
                    }}
                    className={cn(
                      "cursor-pointer transition-colors border-l-2 border-transparent",
                      "hover:bg-active/50",
                      "pl-6 pr-3 py-2",
                      isSelected && "bg-active border-l-accent",
                      isMultiSelected && "ring-2 ring-inset ring-orange-500",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Box className="text-comment flex-shrink-0" size={14} />
                      <span className="truncate text-sm">
                        {blockItem.attrs?.title ||
                         (blockItem.type && getNodeDisplayName(blockItem.type)) ||
                         blockItem.type ||
                         "Unnamed"}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-2 text-comment text-xs">
                {!selectedFile ? 'Finding file...' : !selectedFile.pmJSON ? 'Loading file...' : 'No blocks found'}
              </div>
            )}
          </div>

          {/* Preview Panel */}
          <div className="flex-1 p-3 overflow-y-auto bg-bg/30">
            {previewBlock ? (
              <BlockPreviewEditor block={previewBlock} />
            ) : (
              <div className="text-comment text-xs">Select a block to preview</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 text-xs bg-bg border-t border-border flex justify-between items-center">
          <span
            className="text-comment hover:text-text cursor-pointer transition-colors"
            onClick={() => {
              setIsBlockMode(false);
              setSelectedFile(null);
              setListSelectedIndex(0);
              setMultiSelectedItems([]);
            }}
          >
            ← back to files
          </span>
        </div>
      </div>
    );
  }

  // "Add new file" button — always shown at the bottom of the file list
  const addNewItem: FileLinkItem = { filePath: "", filename: "Add new file", isNew: true };
  const addNewButton = !isBlockMode ? (
    <div
      onClick={() => command(addNewItem)}
      className={cn(
        "px-3 py-2.5 w-full cursor-pointer transition-colors border-l-2 border-transparent border-t border-border",
        "hover:bg-active/50",
      )}
    >
      <div className="flex items-center gap-2">
        <Plus className="text-comment flex-shrink-0" size={14} />
        <span className="font-medium">Add new file</span>
        {isLoadingFiles && <span className="text-xs text-comment ml-auto">loading…</span>}
      </div>
    </div>
  ) : null;

  // RENDERING: File mode (default)
  return (
    <div
      className="w-[480px] bg-panel border border-border rounded-lg shadow-lg text-text text-sm"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => parentEditor?.view.focus()}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg">
        <Folder className="text-accent" size={16} />
        <span className="font-medium text-text">Link File or Block</span>
      </div>

      {/* File List */}
      <div
        ref={scrollContainer}
        className="max-h-[400px] overflow-y-auto"
      >
        {filteredItems.length > 0 ? (
          filteredItems.slice(0, 50).map((item: JSONContent | FileLinkItem, index: number) => {
            const fileItem = item as FileLinkItem;
            const isMultiSelected = multiSelectedItems.some((sel) => {
              const linkItem = sel as FileLinkItem;
              return linkItem.filePath === fileItem.filePath;
            });

            // Normalize path separators to forward slashes for consistent handling across platforms
            const normalizedFilePath = fileItem.filePath.replace(/\\/g, "/");
            const normalizedActiveProject = (getActiveProject() || "").replace(/\\/g, "/");
            const relativePath = normalizedFilePath.replace(normalizedActiveProject, "").replace(/^\/+/, "");
            const folderPath = relativePath.includes("/")
              ? relativePath.substring(0, relativePath.lastIndexOf("/"))
              : "";

            return (
              <div
                key={fileItem.filePath + index}
                ref={setItemRef(index)}
                onClick={() => {
                  command(fileItem);
                }}
                className={cn(
                  "px-3 py-2.5 w-full cursor-pointer transition-colors border-l-2 border-transparent",
                  "hover:bg-active/50",
                  index === listSelectedIndex && "bg-active border-l-accent",
                  isMultiSelected && "ring-2 ring-inset ring-orange-500",
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 mt-0.5">
                    <File className="text-comment" size={14} />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate font-medium">{highlightText(fileItem.filename, fileItem.filenameFragments)}</span>
                    {folderPath && (
                      <Tooltip.Root delayDuration={300} disableHoverableContent>
                        <Tooltip.Trigger asChild>
                          <span className="truncate text-xs text-comment cursor-default">
                            {fileItem.pathFragments?.length
                              ? highlightText(folderPath, fileItem.pathFragments)
                              : truncatePath(folderPath, 50)}
                          </span>
                        </Tooltip.Trigger>
                        {folderPath.length > 50 && (
                          <Tooltip.Portal>
                            <Tooltip.Content
                              side="bottom"
                              align="start"
                              className="px-2 py-1 bg-panel text-xs border border-border text-text rounded max-w-[400px] break-all z-50"
                            >
                              {folderPath}
                              <Tooltip.Arrow className="fill-panel" />
                            </Tooltip.Content>
                          </Tooltip.Portal>
                        )}
                      </Tooltip.Root>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          !isBlockMode && (
            isLoadingFiles ? (
              <div className="flex flex-col gap-3 items-center justify-center py-8">
                <svg className="animate-spin h-5 w-5 text-accent" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Loading ...
              </div>
            ) : (
              <div className="px-3 py-2 text-comment text-xs">No files found</div>
            )
          )
        )}
        {!isBlockMode && filteredItems.length > 50 && (
          <div className="px-3 py-1.5 text-xs text-comment border-t border-border">
            {filteredItems.length - 50} more — type to filter
          </div>
        )}
        {/* Loading indicator for background deep search */}
        {!isBlockMode && filteredItems.length > 0 && isLoadingFiles && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-comment border-t border-border">
            <svg className="animate-spin h-3 w-3 text-accent flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Searching deeper…
          </div>
        )}
        {/* Add new file — always pinned at the bottom */}
        {addNewButton}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 text-xs bg-bg border-t border-border flex justify-between items-center">
        <span className="text-comment">↵ link file • → or Space see blocks</span>
        <span className="text-comment">Shift+↵ multi-select</span>
      </div>
    </div>
  );
});

FileLinkTippyContent.displayName = "FileLinkTippyContent";

export const useFileExists = (absolutePath: string) => {
  return useQuery({
    queryKey: ["file:exists", absolutePath],
    queryFn: async () => {
      // Calls the exposed IPC method from your preload
      return window.electron.fileLink.exists(absolutePath);
    },
  });
};

/**
 * NODE VIEW COMPONENT FOR FILE LINKS
 */
const FileLinkNodeView = ({ node }: NodeViewProps) => {
  const { filePath, filename, isExternal } = node.attrs;
  const [absolutePath, setAbsolutePath] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();

  useElectronEvent<{ path: string }>("file:delete", (data) => {
    // You can perform any custom actions here. For instance, if your node holds file details,
    // you might trigger a re-check for the file's existence or update your local state.

    queryClient.invalidateQueries({
      queryKey: ["file:exists"],
      // Alternatively, if you only want to invalidate queries for the specific path:
      // queryKey: ["file:exists", data.path]
    });
    // Optionally, you could force a refetch or update a local state variable.
  });
  // Compute the absolute path when dependencies change.
  useEffect(() => {
    async function getPath() {
      if (isExternal) {
        setAbsolutePath(filePath);
      } else {
        const absPath = await computeAbsolutePath({ filePath, filename, isExternal });
        setAbsolutePath(absPath);
      }
    }
    getPath();
  }, [filePath, filename, isExternal]);

  const { data: fileExists } = useFileExists(absolutePath || "");

  const handleClick = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (!fileExists) {

      return;
    }
    let absolutePath: string | undefined;
    if (isExternal) {
      absolutePath = filePath;
    } else {
      absolutePath = await computeAbsolutePath({ filePath, filename, isExternal });
    }
    if (absolutePath) {
      openFile(absolutePath, filename);
    }
  };

  // Render the file link with a tooltip if the file doesn't exist.
  const fileLinkElement = (
    <NodeViewWrapper className="inline-block">
      <span
        contentEditable={false}
        className={cn("px-1 hover:bg-alt/40 cursor-pointer rounded-sm", fileExists ? "bg-alt/20" : "bg-red-700/80 hover:bg-red-500")}
        onClick={handleClick}
      >
        @{filename}
      </span>
    </NodeViewWrapper>
  );

  if (!fileExists) {
    return (
      <Tooltip.Root disableHoverableContent>
        <Tooltip.Trigger asChild>{fileLinkElement}</Tooltip.Trigger>
        <Tooltip.Content side="top" className="px-2 py-1 bg-panel text-sm border border-border text-text">
          File not found: {filename}
          <Tooltip.Arrow className="fill-panel" />
        </Tooltip.Content>
      </Tooltip.Root>
    );
  }

  return fileLinkElement;
};

/**
 * SUGGESTION & NODE DEFINITION FOR FILELINK
 */
export const FileLinkPluginKey = new PluginKey("fileLink");

export type FileLinkOptions = {
  HTMLAttributes: Record<string, any>;
  renderText: (props: { options: FileLinkOptions; node: JSONContent }) => string;
  renderHTML: (props: { options: FileLinkOptions; node: JSONContent }) => any;
  suggestion: {
    char: string;
    pluginKey: PluginKey;
    allowSpaces: boolean;
    allow: (props: { state: EditorState; range: Range }) => boolean;
    command: (props: { editor: Editor; range: Range; props: FileLinkItem & { isNew?: boolean; block?: JSONContent; originalFile?: string } }) => void;
    items: (props: { query: string }) => FileLinkItem[];
  };
};

export const FileLink = Node.create<FileLinkOptions>({
  name: "fileLink",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,
  content: "inline*",

  // DEFAULT OPTIONS & RENDERING LOGIC
  addOptions() {
    return {
      HTMLAttributes: {},
      renderText: ({ node }) => `@${node.attrs?.filename || ""}`,
      renderHTML: ({ options, node }) => [
        "span",
        mergeAttributes(
          {
            "data-type": "fileLink",
            "data-file-path": node.attrs?.filePath || "",
            class: "bg-red-500",
          },
          options.HTMLAttributes,
        ),
        `@${node.attrs?.filename || ""}`,
      ],
      suggestion: {
        char: "@",
        pluginKey: FileLinkPluginKey,
        allowSpaces: false,
        // allow: ({ state, range }) => {
        //   const $from = state.doc.resolve(range.from);
        //   const type = state.schema.nodes["fileLink"];
        //   return !!$from.parent.type.contentMatch.matchType(type);
        // },
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const disallowedAncestors = ["blockquote", "bulletList", "orderedList", "codeBlock", "fileLink"];
        
          // Walk up the tree and check all parent nodes
          for (let depth = $from.depth; depth > 0; depth--) {
            const ancestor = $from.node(depth);
            if (disallowedAncestors.includes(ancestor.type.name)) {
              return false;
            }
          }
        
          // Prevent inside disallowed marks too (e.g., link)
          if ($from.marks().some((mark) => ["link"].includes(mark.type.name))) {
            return false;
          }
        
          // Still ensure the current node can accept a fileLink
          const type = state.schema.nodes["fileLink"];
          return !!$from.parent.type.contentMatch.matchType(type);
        },
        command: async ({ editor, range, props }) => {
          const queryClient = getQueryClient();
          const projects = queryClient.getQueryData<{
            projects: { path: string; name: string }[];
            activeProject: string;
          }>(["projects"]);
          const activeProject = projects?.activeProject;

          // If props is an array (multiple items)
          if (Array.isArray(props)) {
            const nodes: any[] = [];

            props.forEach((item) => {
              if (item.block) {
                const blockUid = item.block.attrs?.uid;
                if (!blockUid) {

                  return;
                }
                // Convert original file path to relative if needed.
                // Normalize path separators for cross-platform compatibility
                let relativeFilePath = item.originalFile;
                const normalizedOriginal = item.originalFile?.replace(/\\/g, "/");
                const normalizedProject = activeProject?.replace(/\\/g, "/");
                if (normalizedProject && normalizedOriginal?.startsWith(normalizedProject)) {
                  relativeFilePath = normalizedOriginal.replace(normalizedProject, "");
                }
                // Update the central store with the block.
                useBlockContentStore.getState().setBlock(blockUid, item.block);
                // Insert a linked block.
                nodes.push({
                  type: "linkedBlock",
                  attrs: {
                    blockUid,
                    originalFile: relativeFilePath,
                    type: item.block.type?.name || "",
                  },
                });
              } else if (item.isNew) {
                // For multi-selection, new file creation is not supported

              } else {
                // Insert an existing file link.
                nodes.push({ type: "fileLink", attrs: item });
              }
              // Append a space after each inserted node.
              nodes.push({ type: "text", text: " " });
            });

            editor.chain().focus().deleteRange(range).insertContent(nodes, { updateSelection: true }).run();
            return;
          }

          // Fallback: Single item insertion as before.
          if (props.block) {
            const blockUid = props.block.attrs?.uid;
            if (!blockUid) {

              return;
            }
            // Normalize path separators for cross-platform compatibility
            let relativeFilePath = props.originalFile;
            const normalizedOriginal = props.originalFile?.replace(/\\/g, "/");
            const normalizedProject = activeProject?.replace(/\\/g, "/");
            if (normalizedProject && normalizedOriginal?.startsWith(normalizedProject)) {
              relativeFilePath = normalizedOriginal.replace(normalizedProject, "");
            }
            useBlockContentStore.getState().setBlock(blockUid, props.block);
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent([
                {
                  type: "linkedBlock",
                  attrs: {
                    blockUid,
                    originalFile: relativeFilePath,
                    type: props.block.type?.name || "",
                  },
                },
                { type: "paragraph" },
              ], { updateSelection: true })
              .run();
          } else if (props.isNew) {
            const filePaths = await window.electron?.dialog.openFile({ properties: ["openFile"] });
            if (filePaths?.length) {
              const filePath = filePaths[0];
              const filename = filePath.split(/[\\/]/).pop();
              let isExternal = false;
              let storedFilePath = filePath;

              // Normalize path separators for cross-platform compatibility
              const normalizedFilePath = filePath.replace(/\\/g, "/");
              const normalizedProject = activeProject?.replace(/\\/g, "/");
              if (normalizedProject && !normalizedFilePath.startsWith(normalizedProject)) {
                isExternal = true;
              } else if (normalizedProject) {
                storedFilePath = normalizedFilePath.replace(normalizedProject, "");
              }

              if (filename) {
                editor
                  .chain()
                  .focus()
                  .insertContentAt(range, [
                    { type: "fileLink", attrs: { filePath: storedFilePath, filename, isExternal } },
                    { type: "text", text: " " },
                  ])
                  .run();
              }
            }
          } else if ((props as any).importFile) {
            // Import .void file as a linkedFile block. May be whole-file or section-specific.
            const rawPath = (props as any).importFile as string;
            const normalizedRaw = rawPath.replace(/\\/g, "/");
            const normalizedProject = activeProject?.replace(/\\/g, "/");
            let relativeFilePath = normalizedRaw;
            if (normalizedProject && normalizedRaw.startsWith(normalizedProject)) {
              relativeFilePath = normalizedRaw.replace(normalizedProject, "");
            }
            const sectionUid = (props as any).sectionUid as string | undefined;
            const label = (props as any).sectionLabel
              ?? relativeFilePath.split("/").pop()?.replace(/\.void$/i, "") ?? "";
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent([
                {
                  type: "request-separator",
                  attrs: { uid: crypto.randomUUID(), colorIndex: 0, label },
                },
                {
                  type: "linkedFile",
                  attrs: { uid: crypto.randomUUID(), originalFile: relativeFilePath, sectionUid: sectionUid ?? null },
                },
                { type: "paragraph" },
              ], { updateSelection: true })
              .run();
          } else {
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: "fileLink", attrs: props },
                { type: "text", text: " " },
              ])
              .run();
          }
        },
        // Return empty immediately so TipTap opens the popup without waiting.
        // FileLinkTippyContent handles the actual file list via its own query.
        items: () => [],
      },
    };
  },

  // ATTRIBUTES SETUP
  addAttributes() {
    return {
      filePath: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-file-path"),
        renderHTML: (attributes) => (attributes.filePath ? { "data-file-path": attributes.filePath } : {}),
      },
      filename: {
        default: null,
        parseHTML: (element) => {
          const text = element.textContent;
          return text ? text.replace(/^@/, "") : null;
        },
        renderHTML: () => ({}),
      },
      isExternal: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-is-external") === "true",
        renderHTML: (attributes) => (attributes.isExternal ? { "data-is-external": "true" } : {}),
      },
    };
  },

  // PARSING & RENDERING
  parseHTML() {
    return [{ tag: 'span[data-type="fileLink"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const mergedAttributes = mergeAttributes(
      { "data-type": "fileLink", "data-file-path": node.attrs.filePath },
      this.options.HTMLAttributes,
      HTMLAttributes,
    );
    const html = this.options.renderHTML({ options: { ...this.options, HTMLAttributes: mergedAttributes }, node });
    return typeof html === "string" ? ["span", mergedAttributes, html] : html;
  },

  renderText({ node }) {
    return this.options.renderText({ options: this.options, node });
  },

  // PROSE MIRROR PLUGINS & NODE VIEW
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        render: () => {
          let reactRenderer: ReactRenderer | undefined;
          let popup: any;
          return {
            onStart: (props) => {
              const getSafeReferenceClientRect = () => {
                const rect = props.clientRect?.();
                if (rect && (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0)) {
                  return rect;
                }
                const selection = window.getSelection();
                if (selection?.rangeCount) {
                  const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
                  if (selectionRect && (selectionRect.width > 0 || selectionRect.height > 0)) {
                    return selectionRect;
                  }
                }
                return props.editor.view.dom.getBoundingClientRect();
              };

              reactRenderer = new ReactRenderer(FileLinkTippyContent, { props, editor: props.editor });
              popup = tippy(document.body, {
                getReferenceClientRect: getSafeReferenceClientRect,
                appendTo: () => document.body,
                content: reactRenderer.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "right-start",
                popperOptions: {
                  modifiers: [
                    {
                      name: "flip",
                      options: {
                        fallbackPlacements: ["left-start", "right-start", "bottom-start", "top-start"],
                      },
                    },
                  ],
                },
                // Prevent the tippy container from becoming a focus target —
                // focus must stay in the TipTap editor for keyboard nav to work.
                onCreate(instance) {
                  instance.popper.removeAttribute("tabindex");
                  instance.popper.style.outline = "none";
                },
              });
            },
            onUpdate(props) {
              reactRenderer?.updateProps(props);
              if (popup) {
                const getSafeReferenceClientRect = () => {
                  const rect = props.clientRect?.();
                  if (rect && (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0)) {
                    return rect;
                  }
                  const selection = window.getSelection();
                  if (selection?.rangeCount) {
                    const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
                    if (selectionRect && (selectionRect.width > 0 || selectionRect.height > 0)) {
                      return selectionRect;
                    }
                  }
                  return props.editor.view.dom.getBoundingClientRect();
                };
                popup.setProps({ getReferenceClientRect: getSafeReferenceClientRect });
              }
            },
            onKeyDown(props) {
              if (props.event.key === "Escape") {
                popup?.hide();
                return true;
              }
              return reactRenderer?.ref?.onKeyDown(props) ?? false;
            },
            onExit() {
              popup?.destroy();
              reactRenderer?.destroy();
            },
          };
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileLinkNodeView);
  },
});

export default FileLink;
