import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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

  //   hasContent: !!pmJSON?.content,
  //   isArray: Array.isArray(pmJSON?.content),
  //   contentLength: pmJSON?.content?.length,
  //   sampleNodes: pmJSON?.content?.slice(0, 3).map((n: JSONContent) => ({
  //     type: n.type,
  //     hasAttrs: !!n.attrs,
  //     hasUid: !!n.attrs?.uid,
  //     attrs: n.attrs
  //   }))
  // });

  if (!pmJSON?.content || !Array.isArray(pmJSON.content)) return [];

  // Get linkable node types registered by plugins
  // This allows extensions to specify which of their nodes are linkable
  const linkableNodeTypes = getLinkableNodeTypes();



  const blocks = pmJSON.content.filter((node: JSONContent) => {
    // Don't include linkedBlocks
    if (node.type === "linkedBlock") return false;

    // Only include nodes that have been registered as linkable
    const isLinkable = linkableNodeTypes.includes(node.type || '');

    return isLinkable;
  });


  //   total: blocks.length,
  //   withUid: blocks.filter(b => b.attrs?.uid).length,
  //   withoutUid: blocks.filter(b => !b.attrs?.uid).length,
  //   types: [...new Set(blocks.map(b => b.type))]
  // });

  return blocks;
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

// A preview component for a voiden-wrapper block (read-only tiptap editor).
export function BlockPreviewEditor({ block }: { block: JSONContent }) {
  const { finalExtensions } = useVoidenExtensionsAndSchema();

  // Filter out seamless navigation for preview editors to prevent cursor from entering code blocks
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
    <div className="w-full" contentEditable={false} suppressContentEditableWarning>
      <EditorContent editor={editor} />
    </div>
  );
}

const FileLinkTippyContent = forwardRef((props: FileLinkListProps, ref) => {
  const { items, command } = props;
  const [selectedFile, setSelectedFile] = useState<FileLinkItem | null>(null);
  const { data: voidenFiles } = useGetApyFiles();
  const [listSelectedIndex, setListSelectedIndex] = useState(0);
  const [isBlockMode, setIsBlockMode] = useState(false);
  const [multiSelectedItems, setMultiSelectedItems] = useState<(FileLinkItem | JSONContent)[]>([]);
  
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

  const currentItems = useMemo(() => {
    if (isBlockMode) {
      // Block mode: show blocks from the selected file
      if (!selectedFile) {

        return [];
      }
      if (!selectedFile.pmJSON) {

        return [];
      }
      try {
        const blocks = extractVoidenBlocks(selectedFile.pmJSON);

        //   filename: selectedFile.filename,
        //   blockCount: blocks.length,
        //   blocks: blocks.map(b => ({ type: b.type, title: b.attrs?.title, uid: b.attrs?.uid }))
        // });
        return blocks;
      } catch (error) {

        return [];
      }
    } else {
      // File mode: show all files
      return items;
    }
  }, [isBlockMode, items, selectedFile]);

  const filteredItems = useMemo(() => {
    if (isBlockMode) {
      // In block mode, show all blocks (don't filter by file query)
      // The query was used to find the file, not to filter blocks

      return currentItems;
    } else {
      // In file mode, filter files by query
      return currentItems.filter((item: any) => {
        const text = item.filename;
        return text.toLowerCase().includes(props.query.toLowerCase());
      });
    }
  }, [currentItems, props.query, isBlockMode]);

  const selectedBlock = useMemo(() => {
    if (isBlockMode && selectedFile && filteredItems.length > 0) {
      const item = filteredItems[listSelectedIndex] as JSONContent;
      return item;
    }
    return null;
  }, [isBlockMode, selectedFile, filteredItems, listSelectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      // Arrow Up/Down navigation
      if (event.key === "ArrowUp") {
        setListSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setListSelectedIndex((prev) => (prev + 1) % filteredItems.length);
        return true;
      }

      // Arrow Left: Go back to file mode
      if (event.key === "ArrowLeft" && isBlockMode) {
        setIsBlockMode(false);
        setSelectedFile(null);
        setListSelectedIndex(0);
        return true;
      }

      // Arrow Right or Space: Expand to block mode (if in file mode)
      if ((event.key === "ArrowRight" || event.key === " ") && !isBlockMode) {
        const currentItem = filteredItems[listSelectedIndex] as FileLinkItem;
        if (currentItem && !currentItem.isNew && voidenFiles) {

          //   currentItemPath: currentItem.filePath,
          //   currentItemFilename: currentItem.filename,
          //   voidenFilesCount: voidenFiles.length,
          //   voidenFilesSample: voidenFiles[0]
          // });

          // Find the file with pmJSON data
          // Try matching by filename since paths might be in different formats (relative vs absolute)
          const fileWithData = voidenFiles.find((f: any) => {
            const match = f.filename === currentItem.filename ||
                         f.filePath === currentItem.filePath ||
                         f.filePath.endsWith(currentItem.filePath);
            if (match) {

            }
            return match;
          });

          if (fileWithData) {

            setSelectedFile(fileWithData);
            setIsBlockMode(true);
            setListSelectedIndex(0);
            return true;
          } else {

          }
        }
        return true;
      }

      // Shift+Enter: Multi-selection
      if (event.key === "Enter" && event.shiftKey && !event.repeat) {
        const currentItem = filteredItems[listSelectedIndex];
        if (isBlockMode) {
          const blockItem = currentItem as JSONContent;
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
            // Map each block item into an object with a `block` key and the original file's path.
            const blocksToInsert = multiSelectedItems.map((item) => ({
              block: item as JSONContent,
              originalFile: selectedFile.filePath
            }));
            command(blocksToInsert as any);
          } else {
            command(multiSelectedItems as any);
          }
          setMultiSelectedItems([]);
        } else {
          const selectedItem = filteredItems[listSelectedIndex];
          if (isBlockMode && selectedFile) {
            command({ block: selectedItem as JSONContent, originalFile: selectedFile.filePath });
          } else {
            command(selectedItem as FileLinkItem);
          }
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

  // RENDERING: Block mode with preview panel
  if (isBlockMode && selectedFile) {
    return (
      <div className="w-[720px] bg-panel border border-border rounded-lg shadow-lg text-text text-sm">
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
            {filteredItems.length > 0 ? (
              filteredItems.map((item: JSONContent | FileLinkItem, index: number) => {
                const blockItem = item as JSONContent;
                const isMultiSelected = multiSelectedItems.some((sel) => {
                  const selBlock = sel as JSONContent;
                  return selBlock?.attrs?.uid === blockItem?.attrs?.uid;
                });
                return (
                  <div
                    key={blockItem.attrs?.uid || blockItem.type || index}
                    ref={setItemRef(index)}
                    onClick={() => {
                      setListSelectedIndex(index);

                      // Double-click to insert
                      if (index === listSelectedIndex) {
                        if (multiSelectedItems.length > 0) {
                          const blocksToInsert = multiSelectedItems.map((item) => ({
                            block: item as JSONContent,
                            originalFile: selectedFile.filePath
                          }));
                          command(blocksToInsert as any);
                          setMultiSelectedItems([]);
                        } else {
                          command({ block: blockItem, originalFile: selectedFile.filePath });
                        }
                      }
                    }}
                    className={cn(
                      "px-3 py-2.5 cursor-pointer transition-colors border-l-2 border-transparent",
                      "hover:bg-active/50",
                      index === listSelectedIndex && "bg-active border-l-accent",
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
            {selectedBlock ? (
              <BlockPreviewEditor block={selectedBlock} />
            ) : (
              <div className="text-comment text-xs">Select a block to preview</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 text-xs bg-bg border-t border-border flex justify-between items-center">
          <span className="text-comment">← back to files</span>
          <span className="text-comment">↵ insert • Shift+↵ multi-select</span>
        </div>
      </div>
    );
  }

  // RENDERING: File mode (default)
  return (
    <div className="w-[480px] bg-panel border border-border rounded-lg shadow-lg text-text text-sm">
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
          filteredItems.map((item: JSONContent | FileLinkItem, index: number) => {
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
                    {fileItem.filename === "Add new file" ? (
                      <Plus className="text-comment" size={14} />
                    ) : (
                      <File className="text-comment" size={14} />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate font-medium">{fileItem.filename}</span>
                    {folderPath && (
                      <Tooltip.Root delayDuration={300} disableHoverableContent>
                        <Tooltip.Trigger asChild>
                          <span className="truncate text-xs text-comment cursor-default">
                            {truncatePath(folderPath, 50)}
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
          <div className="px-3 py-2 text-comment text-xs">No files found</div>
        )}
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
                // For multi-selection, handling new file creation might require a different approach.
                // You could either disallow multi-select for new files or handle it separately.

              } else {
                // Insert an existing file link.
                nodes.push({
                  type: "fileLink",
                  attrs: item,
                });
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
        items: ({ query }) => {
          const queryClient = getQueryClient();
          const state = queryClient.getQueryData<{ activeDirectory: string }>(["app:state"]);
          const activeDirPath = state?.activeDirectory;
          const data = queryClient.getQueryData<{ files: { filePath: string; filename: string }[] }>(["files:tree", activeDirPath]);

          const projects = queryClient.getQueryData<{ projects: { path: string; name: string }[]; activeProject: string }>(["projects"]);
          const activeProject = projects?.activeProject;
          // Retrieve the currently active document (ensure this includes the filePath)
          const tabsData = queryClient.getQueryData(["panel:tabs", "main"]);
          const activeDocument = tabsData?.tabs?.find((tab) => tab.id === tabsData?.activeTabId);
          // Get all file links
          const fileLinks = getFileLinks(data, activeProject || "");

          // Handle both forward and back slashes for cross-platform compatibility
          const getBasename = (filePath: string) => filePath?.split(/[\\/]/)?.pop();

          const filteredItems = fileLinks.filter((item) => {
            const activeFileName = activeDocument ? getBasename(activeDocument.source) : "";
            const itemFileName = getBasename(item.filePath);
            return item.filename.toLowerCase().includes(query.toLowerCase()) && itemFileName !== activeFileName;
          });

          return [...filteredItems, { filePath: "", filename: "Add new file", isNew: true }];
        },
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
              reactRenderer = new ReactRenderer(FileLinkTippyContent, { props, editor: props.editor });
              popup = tippy(document.body, {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: reactRenderer.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "auto",
              });
            },
            onUpdate(props) {
              reactRenderer?.updateProps(props);
              if (popup) {
                popup.setProps({ getReferenceClientRect: props.clientRect });
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
