import React, { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { Button } from "@/core/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent, PopoverPortal, PopoverClose } from "@radix-ui/react-popover";
import { Editor } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { useHotkeys } from "react-hotkeys-hook";
import { LuGripVertical } from "react-icons/lu";
import { useGetActiveDocument } from "@/core/documents/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Kbd } from "@/core/components/ui/kbd";

// ────────────────────────────────────────────────
// Memoized DragMenuItem Component
interface DragMenuItemProps {
  onClick: () => void;
  label: string;
  shortcut?: React.ReactNode;
  disabled?: boolean;
}

export const DragMenuItem: React.FC<DragMenuItemProps> = React.memo(({ onClick, label, shortcut, disabled }: DragMenuItemProps) => {
  return (
    <PopoverClose asChild>
      <button
        className={`px-3 py-1 w-full text-left rounded focus:bg-active transition-colors ${disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-active text-text hover:text-text focus:outline-none cursor-pointer"
          }`}
        onClick={onClick}
        disabled={disabled}
      >
        <div className="flex items-center justify-between w-full">
          <span className="text-sm">{label}</span>
          {shortcut && <div className="text-xs text-comment ml-4">{shortcut}</div>}
        </div>
      </button>
    </PopoverClose>
  );
});

DragMenuItem.displayName = "DragMenuItem";

// ────────────────────────────────────────────────
// Custom hook for node-related actions
export const useActions = (editor: Editor) => {
  const [currentNode, setCurrentNode] = useState<Node | null>(null);
  const [currentNodePos, setCurrentNodePos] = useState<number>(-1);
  const { data: activeDocument } = useGetActiveDocument();
  const queryClient = useQueryClient();

  // Helper function to safely focus the editor with fallback logic
  const safeFocusEditor = useCallback((preferredPos: number) => {
    try {
      const { doc } = editor.state;
      const maxPos = doc.content.size;

      // Clamp position to valid range
      const clampedPos = Math.max(0, Math.min(preferredPos, maxPos));

      // Determine search direction:
      // - If at or near end of document, search backwards
      // - If in the middle, search forwards (content below shifts up)
      const isNearEnd = clampedPos >= maxPos - 2;
      const searchDirection = isNearEnd ? -1 : 1;

      try {
        // Use ProseMirror's TextSelection.near() to find the nearest valid position
        const $pos = doc.resolve(clampedPos);
        const selection = editor.state.selection.constructor as any;

        // Create selection with appropriate search direction
        const nearSelection = selection.near($pos, searchDirection);

        if (nearSelection && nearSelection.node.type.name !== "horizontalRule") {
          editor.view.dispatch(
            editor.state.tr.setSelection(nearSelection)
          );
          editor.view.focus();
          return;
        }
      } catch (e) {
        console.debug('Failed to create selection near position:', clampedPos, e);
      }

      // Fallback 1: Try focusing at the position directly
      try {
        editor.chain().focus(clampedPos).run();
        return;
      } catch (e) {
        console.debug('Direct focus failed at position:', clampedPos, e);
      }

      // Fallback 2: Try adjacent position based on direction
      const adjacentPos = isNearEnd ? Math.max(0, clampedPos - 1) : Math.min(maxPos, clampedPos + 1);
      if (adjacentPos >= 0 && adjacentPos <= maxPos) {
        try {
          editor.chain().focus(adjacentPos).run();
          return;
        } catch (e) {
          console.debug('Focus failed at adjacent position:', adjacentPos, e);
        }
      }

      // Fallback 3: Try the opposite direction
      const oppositePos = isNearEnd ? Math.min(maxPos, clampedPos + 1) : Math.max(0, clampedPos - 1);
      if (oppositePos >= 0 && oppositePos <= maxPos && oppositePos !== adjacentPos) {
        try {
          editor.chain().focus(oppositePos).run();
          return;
        } catch (e) {
          console.debug('Focus failed at opposite position:', oppositePos, e);
        }
      }

      // Last resort: Just focus the editor without specific position
      editor.commands.focus();
    } catch (e) {
      console.error('safeFocusEditor encountered unexpected error:', e);
      // Ultimate fallback
      try {
        editor.commands.focus();
      } catch (finalError) {
        console.error('Could not restore editor focus at all:', finalError);
      }
    }
  }, [editor]);

  const handleAddBlockAbove = useCallback(() => {
    if (currentNodePos !== -1) {
      const insertPos = currentNodePos;
      const focusPos = insertPos + 2;

      editor
        .chain()
        .command(({ dispatch, tr, state }) => {
          if (dispatch) {
            tr.insert(insertPos, state.schema.nodes.paragraph.create(null, [state.schema.text("/")]));
            return dispatch(tr);
          }
          return true;
        })
        .focus(focusPos)
        .run();
    }
  }, [editor, currentNodePos]);

  const handleAddBlockBelow = useCallback(() => {
    if (currentNodePos !== -1) {
      const currentNodeSize = currentNode?.nodeSize || 0;
      const insertPos = currentNodePos + currentNodeSize;
      const currentNodeIsEmptyParagraph = currentNode?.type.name === "paragraph" && currentNode?.content?.size === 0;
      const focusPos = currentNodeIsEmptyParagraph ? currentNodePos + 2 : insertPos + 2;

      editor
        .chain()
        .command(({ dispatch, tr, state }) => {
          if (dispatch) {
            if (currentNodeIsEmptyParagraph) {
              tr.insertText("/", currentNodePos, currentNodePos + 1);
            } else {
              tr.insert(insertPos, state.schema.nodes.paragraph.create(null, [state.schema.text("/")]));
            }
            return dispatch(tr);
          }
          return true;
        })
        .focus(focusPos)
        .run();
    }
  }, [editor, currentNode, currentNodePos]);

  const duplicateNode = useCallback(() => {
    editor.commands.setNodeSelection(currentNodePos);
    const { $anchor } = editor.state.selection;
    const selectedNode = $anchor.node(1) || (editor.state.selection as NodeSelection).node;

    const currentNodeSize = currentNode?.nodeSize || 0;
    const newNodePos = currentNodePos + currentNodeSize;

    editor
      .chain()
      .insertContentAt(newNodePos, selectedNode.toJSON())
      .run();

    // Focus at the start of the duplicated node
    setTimeout(() => {
      safeFocusEditor(newNodePos + 1);
    }, 0);
  }, [editor, currentNodePos, currentNode?.nodeSize, safeFocusEditor]);

  const copyNode = useCallback(() => {
    navigator.clipboard.writeText(`block://${JSON.stringify(currentNode?.toJSON())}`);

    // Restore focus to the copied node (inside the node content)
    setTimeout(() => {
      safeFocusEditor(currentNodePos + 1);
    }, 0);
  }, [currentNode, currentNodePos, safeFocusEditor]);

  const cutNode = useCallback(() => {
    navigator.clipboard.writeText(`block://${JSON.stringify(currentNode?.toJSON())}`);
    editor.chain().setNodeSelection(currentNodePos).deleteSelection().run();

    // Restore focus to where the node was (with fallback)
    setTimeout(() => {
      safeFocusEditor(currentNodePos);
    }, 0);
  }, [editor, currentNode, currentNodePos, safeFocusEditor]);

  const linkNode = useCallback(() => {
    const blockUid = currentNode?.attrs?.uid;
    const blockType = currentNode?.type.name;
    const originalFile = activeDocument?.source;

    if (!blockUid || !originalFile) {
      console.warn("Cannot create link: missing uid or source file");
      return;
    }

    const projects = queryClient.getQueryData<{
      projects: { path: string; name: string }[];
      activeProject: string;
    }>(["projects"]);
    const activeProject = projects?.activeProject;

    let relativeFilePath = originalFile;

    if (activeProject && originalFile.startsWith(activeProject)) {
      relativeFilePath = originalFile.replace(activeProject, "");
      if (relativeFilePath.startsWith("/")) {
        relativeFilePath = relativeFilePath.slice(1);
      }
    }

    const linkedBlockData = {
      type: "linkedBlock",
      attrs: {
        blockUid,
        originalFile: relativeFilePath,
        type: blockType || "",
      },
    };

    navigator.clipboard.writeText(`linkblock://${JSON.stringify(linkedBlockData)}`);
  }, [currentNode, activeDocument, queryClient]);

  const deleteNode = useCallback(() => {
    editor.chain().setNodeSelection(currentNodePos).deleteSelection().run();

    // Restore focus to where the node was (with fallback)
    setTimeout(() => {
      safeFocusEditor(currentNodePos);
    }, 0);
  }, [editor, currentNodePos, safeFocusEditor]);

  // ── Section-level operations (for request-separator nodes) ──

  /** Get the range of nodes belonging to the section starting at this separator */
  const getSectionRange = useCallback(() => {
    if (!currentNode || currentNode.type.name !== 'request-separator') return null;

    const doc = editor.state.doc;
    const sectionStart = currentNodePos;
    let sectionEnd = doc.content.size;

    // Find the next separator to determine section end
    let pos = currentNodePos + currentNode.nodeSize;
    doc.nodesBetween(pos, doc.content.size, (node, nodePos) => {
      if (node.type.name === 'request-separator' && nodePos > currentNodePos) {
        sectionEnd = nodePos;
        return false; // stop
      }
      return false; // only check top-level nodes
    });

    return { from: sectionStart, to: sectionEnd };
  }, [editor, currentNode, currentNodePos]);

  /** Get all nodes in the current section as JSON */
  const getSectionNodes = useCallback(() => {
    const range = getSectionRange();
    if (!range) return [];

    const doc = editor.state.doc;
    const nodes: any[] = [];
    doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (pos >= range.from && pos < range.to) {
        nodes.push(node.toJSON());
      }
      return false; // don't descend
    });

    return nodes;
  }, [editor, getSectionRange]);

  const copySectionBlock = useCallback(() => {
    const nodes = getSectionNodes();
    if (nodes.length === 0) return;
    // Skip the separator itself, copy only the content blocks
    const contentNodes = nodes.filter(n => n.type !== 'request-separator');
    navigator.clipboard.writeText(`sectionblock://${JSON.stringify(contentNodes)}`);

    setTimeout(() => {
      safeFocusEditor(currentNodePos + 1);
    }, 0);
  }, [getSectionNodes, currentNodePos, safeFocusEditor]);

  const cutSectionBlock = useCallback(() => {
    const nodes = getSectionNodes();
    if (nodes.length === 0) return;
    const contentNodes = nodes.filter(n => n.type !== 'request-separator');
    navigator.clipboard.writeText(`sectionblock://${JSON.stringify(contentNodes)}`);

    const range = getSectionRange();
    if (range) {
      editor.chain()
        .command(({ dispatch, tr }) => {
          if (dispatch) {
            tr.delete(range.from, range.to);
            return dispatch(tr);
          }
          return true;
        })
        .run();

      setTimeout(() => {
        safeFocusEditor(Math.min(range.from, editor.state.doc.content.size));
      }, 0);
    }
  }, [editor, getSectionNodes, getSectionRange, safeFocusEditor]);

  const deleteSectionBlock = useCallback(() => {
    const range = getSectionRange();
    if (!range) return;

    editor.chain()
      .command(({ dispatch, tr }) => {
        if (dispatch) {
          tr.delete(range.from, range.to);
          return dispatch(tr);
        }
        return true;
      })
      .run();

    setTimeout(() => {
      safeFocusEditor(Math.min(range.from, editor.state.doc.content.size));
    }, 0);
  }, [editor, getSectionRange, safeFocusEditor]);

  const linkSectionBlock = useCallback(() => {
    const nodes = getSectionNodes();
    if (nodes.length === 0) return;

    const originalFile = activeDocument?.source;
    if (!originalFile) return;

    const projects = queryClient.getQueryData<{
      projects: { path: string; name: string }[];
      activeProject: string;
    }>(["projects"]);
    const activeProject = projects?.activeProject;

    let relativeFilePath = originalFile;
    if (activeProject && originalFile.startsWith(activeProject)) {
      relativeFilePath = originalFile.replace(activeProject, "");
      if (relativeFilePath.startsWith("/")) {
        relativeFilePath = relativeFilePath.slice(1);
      }
    }

    // Create linked blocks for each content node in the section (skip separator)
    const contentNodes = nodes.filter(n => n.type !== 'request-separator');
    const linkedBlocks = contentNodes
      .filter(n => n.attrs?.uid)
      .map(n => ({
        type: "linkedBlock",
        attrs: {
          blockUid: n.attrs.uid,
          originalFile: relativeFilePath,
          type: n.type || "",
        },
      }));

    if (linkedBlocks.length > 0) {
      navigator.clipboard.writeText(`linkblock://${JSON.stringify(linkedBlocks)}`);
    }
  }, [getSectionNodes, activeDocument, queryClient]);

  return {
    currentNode,
    currentNodePos,
    setCurrentNode,
    setCurrentNodePos,
    handleAddBlockAbove,
    handleAddBlockBelow,
    deleteNode,
    duplicateNode,
    copyNode,
    cutNode,
    linkNode,
    copySectionBlock,
    cutSectionBlock,
    deleteSectionBlock,
    linkSectionBlock,
  };
};

// ────────────────────────────────────────────────
// Memoized Popover Content Component
interface DragPopoverContentProps {
  duplicateNode: () => void;
  handleAddBlockAbove: () => void;
  handleAddBlockBelow: () => void;
  deleteNode: () => void;
  duplicateShortcut: string;
  deleteShortcut: string;
  copyNode: () => void;
  cutNode: () => void;
  linkNode: () => void;
  copyDisabled: boolean;
  showLinkBlock: boolean;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isSectionSeparator?: boolean;
  copySectionBlock?: () => void;
  cutSectionBlock?: () => void;
  deleteSectionBlock?: () => void;
  linkSectionBlock?: () => void;
}

const DragPopoverContent: React.FC<DragPopoverContentProps> = React.memo(
  ({ duplicateNode, handleAddBlockAbove, handleAddBlockBelow, deleteNode, duplicateShortcut, deleteShortcut, copyNode, cutNode, linkNode, copyDisabled, showLinkBlock, onKeyDown, isSectionSeparator, copySectionBlock, cutSectionBlock, deleteSectionBlock, linkSectionBlock }: DragPopoverContentProps) => {
    const isMac = navigator.userAgent.includes("Mac");
    const modKey = isMac ? "⌘" : "Ctrl";
    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-focus first item when menu opens
    useEffect(() => {
      if (contentRef.current) {
        const firstButton = contentRef.current.querySelector('button:not([disabled])') as HTMLElement;
        firstButton?.focus();
      }
    }, []);

    return (
      <PopoverPortal>
        <PopoverContent
          ref={contentRef}
          side="right"
          align="start"
          className="bg-bg border border-border rounded-md shadow-lg text-text text-sm p-1 z-50"
          sideOffset={8}
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {isSectionSeparator ? (
            <>
              <DragMenuItem onClick={copySectionBlock!} label="Copy Request" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘C" size="sm"></Kbd></span>} />
              <DragMenuItem onClick={cutSectionBlock!} label="Cut Request" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘X" size="sm"></Kbd></span>} />
              <DragMenuItem onClick={linkSectionBlock!} label="Link Request" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘L" size="sm"></Kbd></span>} />
              <div className="h-px bg-border my-1" />
              <DragMenuItem onClick={deleteSectionBlock!} label="Delete Request" shortcut={<span className="inline-block mr-1"><Kbd keys="⌫" size="sm"></Kbd></span>} />
            </>
          ) : (
            <>
              <DragMenuItem onClick={handleAddBlockAbove} label="Add Block Above" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘⇧↑" size="sm"></Kbd></span>} />
              <DragMenuItem onClick={handleAddBlockBelow} label="Add Block Below" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘⇧↓" size="sm"></Kbd></span>} />
              <div className="h-px bg-border my-1" />
              <DragMenuItem onClick={copyNode} label="Copy Block" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘C" size="sm"></Kbd></span>} disabled={copyDisabled} />
              <DragMenuItem onClick={cutNode} label="Cut Block" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘X" size="sm"></Kbd></span>} disabled={copyDisabled} />
              {showLinkBlock && (
                <DragMenuItem onClick={linkNode} label="Link Block" shortcut={<span className="inline-block mr-1"><Kbd keys="⌘L" size="sm"></Kbd></span>} disabled={copyDisabled} />
              )}
              <div className="h-px bg-border my-1" />
              <DragMenuItem onClick={deleteNode} label="Delete" shortcut={<span className="inline-block mr-1"><Kbd keys="⌫" size="sm"></Kbd></span>} />
            </>
          )}
        </PopoverContent>
      </PopoverPortal>
    );
  },
);

DragPopoverContent.displayName = "DragPopoverContent";

// ────────────────────────────────────────────────
// Main Component
export const VoidenDragMenu = React.memo(({ editor }: { editor: Editor }) => {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [editorContainer, setEditorContainer] = useState<HTMLElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastMouseNodePos = useRef<number>(-1);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Use the actions hook
  const {
    currentNode,
    currentNodePos,
    setCurrentNode,
    setCurrentNodePos,
    handleAddBlockAbove,
    handleAddBlockBelow,
    deleteNode,
    duplicateNode,
    copyNode,
    cutNode,
    linkNode,
    copySectionBlock,
    cutSectionBlock,
    deleteSectionBlock,
    linkSectionBlock,
  } = useActions(editor);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      menuOpenRef.current = open;
      setIsOpen(open);
    },
    []
  );

  // Find the editor container
  useEffect(() => {
    const container = editor.view.dom.parentElement;
    if (container) {
      const computedStyle = window.getComputedStyle(container);
      if (computedStyle.position === 'static') {
        container.style.position = 'relative';
      }
      setEditorContainer(container);
    }
  }, [editor]);

  // Update menu position based on cursor/selection
  useEffect(() => {
    const updateMenuFromSelection = () => {
      if (!editorContainer || menuOpenRef.current) return;

      const { view, state } = editor;
      const { selection } = state;
      const { $from } = selection;

      // Function to find the target node for toolbar
      const findTargetNode = () => {
        // Try regular depth > 0 case first
        if ($from.depth > 0) {
          const node = $from.node(1);
          const nodePos = $from.before(1);
          return { node, nodePos };
        }

        // For depth 0 (atom nodes or document root)
        const pos = $from.pos;

        // Option A: Find node by traversing
        let currentNode = $from.node(0); // Root
        let currentPos = 0;

        // Walk through the document to find the node at/before cursor
        state.doc.descendants((node, nodePos) => {
          const nodeEnd = nodePos + node.nodeSize;

          // Check if cursor is within or adjacent to this node
          if (
            (node.type.name === "codeBlock" || node.type.name === "paragraph") &&
            (
              // Cursor is inside node (for non-atom nodes)
              (pos >= nodePos && pos <= nodeEnd) ||
              // Cursor is right before node
              pos === nodePos ||
              // Cursor is right after node
              pos === nodeEnd
            )
          ) {
            currentNode = node;
            currentPos = nodePos;
            return false; // Stop searching
          }
        });

        return { node: currentNode, nodePos: currentPos };
      };

      const { node, nodePos } = findTargetNode();

      // Update if it's a different node
      if (node && nodePos !== -1 && lastMouseNodePos.current !== nodePos) {
        setCurrentNode(node);
        setCurrentNodePos(nodePos);
        lastMouseNodePos.current = nodePos;

        try {
          const containerRect = editorContainer.getBoundingClientRect();
          const coords = view.coordsAtPos(nodePos);

          setPosition({
            top: coords.top - containerRect.top,
            left: -5,
          });
        } catch (e) {
          console.error('Error calculating position:', e);
        }
      }
    };

    // Update on selection change
    const handleSelectionUpdate = () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      updateTimeoutRef.current = setTimeout(updateMenuFromSelection, 10);
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    editor.on('update', handleSelectionUpdate);

    // Initial update
    updateMenuFromSelection();

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
      editor.off('update', handleSelectionUpdate);
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [editor, editorContainer, setCurrentNode, setCurrentNodePos]);

  // Track mouse movement over the editor
  useEffect(() => {
    if (!editorContainer) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (menuOpenRef.current) return;

      const { view, state } = editor;
      const editorRect = view.dom.getBoundingClientRect();
      const containerRect = editorContainer.getBoundingClientRect();

      // Check if mouse is within editor bounds
      if (
        e.clientX >= editorRect.left &&
        e.clientX <= editorRect.right &&
        e.clientY >= editorRect.top &&
        e.clientY <= editorRect.bottom
      ) {
        try {
          const mouseY = e.clientY;
          let foundNode = null;
          let foundPos = -1;

          // Iterate through document nodes and find their DOM elements
          let currentPos = 0;
          for (let i = 0; i < state.doc.childCount; i++) {
            const node = state.doc.child(i);
            const nodePos = currentPos;

            try {
              // Get the DOM node for this position
              // For atom nodes and node views, we need to get the nodeDOM directly
              const domNode = view.nodeDOM(nodePos);

              if (domNode && domNode instanceof HTMLElement) {
                const rect = domNode.getBoundingClientRect();

                // Check if mouse Y is within this block's bounds
                if (mouseY >= rect.top && mouseY <= rect.bottom) {
                  foundNode = node;
                  foundPos = nodePos;
                  break;
                }
              }
            } catch (err) {
              // Try alternative method using domAtPos
              try {
                const domAtPos = view.domAtPos(nodePos + 1);
                if (domAtPos && domAtPos.node) {
                  let element = domAtPos.node;

                  // Walk up to find an HTMLElement
                  while (element && !(element instanceof HTMLElement)) {
                    element = element.parentNode;
                  }

                  if (element instanceof HTMLElement) {
                    // Walk up to find the top-level block element
                    while (element && element.parentElement !== view.dom && element !== view.dom) {
                      element = element.parentElement;
                    }

                    if (element && element !== view.dom) {
                      const rect = element.getBoundingClientRect();

                      if (mouseY >= rect.top && mouseY <= rect.bottom) {
                        foundNode = node;
                        foundPos = nodePos;
                        break;
                      }
                    }
                  }
                }
              } catch (err2) {
                // Ignore
              }
            }

            currentPos += node.nodeSize;
          }

          // Fallback to posAtCoords
          if (!foundNode) {
            const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });

            if (pos) {
              const $pos = state.doc.resolve(pos.pos);

              if ($pos.depth > 0) {
                foundNode = $pos.node(1);
                foundPos = $pos.before(1);
              }
            }
          }

          // Update if we found a node and it's different
          if (foundNode && foundPos !== -1 && lastMouseNodePos.current !== foundPos) {
            setCurrentNode(foundNode);
            setCurrentNodePos(foundPos);
            lastMouseNodePos.current = foundPos;

            const coords = view.coordsAtPos(foundPos);

            setPosition({
              top: coords.top - containerRect.top,
              left: -5,
            });
          }
        } catch (e) {
          // Ignore errors
        }
      }
    };

    editorContainer.addEventListener('mousemove', handleMouseMove);

    return () => {
      editorContainer.removeEventListener('mousemove', handleMouseMove);
    };
  }, [editor, editorContainer, setCurrentNode, setCurrentNodePos]);

  // Hotkeys
  const handleBackspace = useCallback(() => {
    if (menuOpenRef.current) {
      deleteNode();
    }
  }, [deleteNode]);

  const handleDuplicate = useCallback(() => {
    if (menuOpenRef.current) {
      duplicateNode();
    }
  }, [duplicateNode]);

  const handleCopyHotkey = useCallback(() => {
    if (menuOpenRef.current) {
      copyNode();
    }
  }, [copyNode]);

  const handleCutHotkey = useCallback(() => {
    if (menuOpenRef.current) {
      cutNode();
    }
  }, [cutNode]);

  const handleAddBlockAboveHotkey = useCallback(() => {
    if (menuOpenRef.current) {
      handleAddBlockAbove();
    }
  }, [handleAddBlockAbove]);

  const handleAddBlockBelowHotkey = useCallback(() => {
    if (menuOpenRef.current) {
      handleAddBlockBelow();
    }
  }, [handleAddBlockBelow]);

  const handleLinkHotkey = useCallback(() => {
    if (menuOpenRef.current) {
      linkNode();
    }
  }, [linkNode]);

  const handleOpenMenuHotkey = useCallback(() => {
    if (!isOpen) {
      setIsOpen(true);
      handleOpenChange(true);
    }
  }, [isOpen, handleOpenChange]);

  // Keyboard navigation for menu items
  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = e.currentTarget.querySelectorAll('button:not([disabled])');
      const currentIndex = Array.from(items).findIndex(item => item === document.activeElement);

      let nextIndex = currentIndex;
      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex + 1 >= items.length ? 0 : currentIndex + 1;
      } else if (e.key === 'ArrowUp') {
        nextIndex = currentIndex - 1 < 0 ? items.length - 1 : currentIndex - 1;
      }

      (items[nextIndex] as HTMLElement)?.focus();
    }
  }, []);

  useHotkeys("backspace", handleBackspace, {}, [handleBackspace]);
  useHotkeys("mod+d", handleDuplicate, {}, [handleDuplicate]);
  useHotkeys("mod+c", handleCopyHotkey, {}, [handleCopyHotkey]);
  useHotkeys("mod+x", handleCutHotkey, {}, [handleCutHotkey]);
  useHotkeys("mod+shift+up", handleAddBlockAboveHotkey, {}, [handleAddBlockAboveHotkey]);
  useHotkeys("mod+shift+down", handleAddBlockBelowHotkey, {}, [handleAddBlockBelowHotkey]);
  useHotkeys("mod+l", handleLinkHotkey, {}, [handleLinkHotkey]);
  useHotkeys("mod+.", handleOpenMenuHotkey, { enableOnContentEditable: true }, [handleOpenMenuHotkey]);

  const hasUid = currentNode?.attrs?.uid != null;
  const copyDisabled = false;
  const duplicateShortcut = useMemo(() => (navigator.userAgent.includes("Mac") ? "⌘D" : "Ctrl+D"), []);
  const deleteShortcut = "Del";

  // Hide menu for certain node types or when not editable
  const hideMenu =
    !currentNode ||
    !position ||
    !editor.isEditable ||
    !editorContainer ||
    currentNode.type.name === "title" ||
    currentNode.type.name === "method" ||
    currentNode.type.name === "url";

  if (hideMenu) {
    return null;
  }

  const menuContent = (
    <div
      ref={menuRef}
      className="absolute pointer-events-auto"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 10,
      }}
    >
      <div className="flex items-center space-x-0.5 text-muted-foreground">
        <Popover open={isOpen} onOpenChange={handleOpenChange} modal={false}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="p-0.5 cursor-pointer text-comment hover:bg-active hover:text-text"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <LuGripVertical size={16} />
            </Button>
          </PopoverTrigger>
          <DragPopoverContent
            duplicateNode={duplicateNode}
            handleAddBlockAbove={handleAddBlockAbove}
            handleAddBlockBelow={handleAddBlockBelow}
            deleteNode={deleteNode}
            copyNode={copyNode}
            cutNode={cutNode}
            linkNode={linkNode}
            duplicateShortcut={duplicateShortcut}
            deleteShortcut={deleteShortcut}
            copyDisabled={copyDisabled}
            showLinkBlock={hasUid}
            onKeyDown={handleMenuKeyDown}
            isSectionSeparator={currentNode?.type.name === 'request-separator'}
            copySectionBlock={copySectionBlock}
            cutSectionBlock={cutSectionBlock}
            deleteSectionBlock={deleteSectionBlock}
            linkSectionBlock={linkSectionBlock}
          />
        </Popover>
      </div>
    </div>
  );

  return createPortal(menuContent, editorContainer);
});


DragMenuItem.displayName = "DragMenuItem";
DragPopoverContent.displayName = "DragPopoverContent";
VoidenDragMenu.displayName = "VoidenDragMenu";
