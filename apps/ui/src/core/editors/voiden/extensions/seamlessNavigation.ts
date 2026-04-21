import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

/**
 * Seamless Navigation Extension
 *
 * Enables smooth arrow key navigation between Tiptap content and embedded CodeMirror blocks.
 * When pressing up/down arrows at document boundaries, it focuses into/out of code blocks.
 */
export const SeamlessNavigation = Extension.create({
  name: 'seamlessNavigation',

  // Lower priority so table handlers run FIRST
  priority: 50,

  addProseMirrorPlugins() {
    // Track if we should skip appendTransaction (when modifier keys are used)
    let modifierKeyPressed = false;
    let skipAppendTransaction = false;
    let pendingCodeMirrorFocus: any = null;
    let isSettingCodeMirrorFocus = false;
    return [
      new Plugin({
        key: new PluginKey('seamlessNavigation'),
        props: {
          handleDOMEvents: {
            keydown: (view, event) => {
              const isSelectAll = (event.metaKey || event.ctrlKey) &&
                (event.key === 'a' || event.key === 'A');

              if (isSelectAll) {
                modifierKeyPressed = true;
              }

              if (event.key === 'Meta' || event.key === 'Control') {
                modifierKeyPressed = true;
              }

              return false;
            },

            // Reset when keys are released
            keyup: (view, event) => {
              if (event.key === 'Meta' || event.key === 'Control' ||
                event.key === 'a' || event.key === 'A') {
                modifierKeyPressed = false;
              }
              return false;
            }
          }
        },

        appendTransaction: (transactions, oldState, newState) => {
          // Skip if modifier key was used
          if (modifierKeyPressed) {
            return null;
          }
          pendingCodeMirrorFocus = null;

          if (skipAppendTransaction) {
            skipAppendTransaction = false; // Reset for next time
            return null;
          }
          if (isSettingCodeMirrorFocus) {
            return null;
          }

          // Check if an arrow key was pressed and the selection changed
          const selectionChanged = !oldState.selection.eq(newState.selection);
          if (!selectionChanged) return null;

          // Don't interfere with CellSelection (table multi-select)
          // CellSelection is used when selecting multiple table cells
          // Note: The constructor name is '_CellSelection' with underscore
          if (newState.selection instanceof CellSelection) {
            return null;
          }

          // Don't interfere with transactions that are inserting content (like tables)
          const isInserting = transactions.some(tr => tr.steps.length > 0 && tr.steps.some(step =>
            step.toJSON?.()?.stepType === 'replace' || step.toJSON?.()?.stepType === 'replaceAround'
          ));
          if (isInserting) {
            return null;
          }

          const { $anchor: old$anchor } = oldState.selection;
          const { $anchor } = newState.selection;
          const parent = $anchor.parent;

          // Define block types
          const codeBlockTypes = [
            'codeBlock', 'json_body', 'xml_body', "gqlquery", "gqlbody", "gqlvariables"
          ];

          // Helper function to check if a node is a table block
          // A table block contains a table node which contains tableRow children
          const isTableBlock = (node: any) => {
            if (!node) return false;

            // Check if the node itself has tableRow children (direct table)
            let hasTableRow = false;
            if (node.content) {
              node.content.forEach((child: any) => {
                if (child.type.name === 'tableRow') {
                  hasTableRow = true;
                }
              });
            }
            if (hasTableRow) return true;

            // Check if node contains a table child (table wrapper pattern)
            // e.g., headers-table -> table -> tableRow
            if (node.content) {
              for (let i = 0; i < node.content.childCount; i++) {
                const child = node.content.child(i);
                if (child.type.name === 'table' && child.content) {
                  // Check if this table has tableRow children
                  child.content.forEach((grandchild: any) => {
                    if (grandchild.type.name === 'tableRow') {
                      hasTableRow = true;
                    }
                  });
                }
              }
            }

            return hasTableRow;
          };

          // Check if we were in a table cell before and track column index
          let wasInTableCell = false;
          let oldColumnIndex = -1;

          for (let d = old$anchor.depth; d > 0; d--) {
            const node = old$anchor.node(d);
            if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
              wasInTableCell = true;
            }
            if (node.type.name === 'tableRow') {
              // Found the row, now find which cell we were in
              const row = node;
              let cellPos = old$anchor.start(d) + 1; // Start of row + 1
              for (let i = 0; i < row.childCount; i++) {
                const cell = row.child(i);
                if (old$anchor.pos >= cellPos && old$anchor.pos < cellPos + cell.nodeSize) {
                  oldColumnIndex = i;
                  break;
                }
                cellPos += cell.nodeSize;
              }
              break;
            }
          }


          // Check if we were in a code block before (by checking the parent node type)
          let wasInCodeBlock = false;
          const oldParent = old$anchor.parent;
          if (codeBlockTypes.includes(oldParent.type.name)) {
            wasInCodeBlock = true;
          }

          // Check if we landed in a position without inline content
          const isInvalidPosition = !parent.isTextblock || !parent.type.spec.content?.includes('inline');

          if (isInvalidPosition) {

            // If we were in a table and now we're at doc/invalid level, we exited the table
            // Try to find if there's a DIFFERENT table block before us to enter
            if (wasInTableCell && parent.type.name === 'doc') {


              // First, figure out which table block we just exited from
              let oldTablePos = null;
              let currentPos = 0;
              for (let i = 0; i < oldState.doc.childCount; i++) {
                const child = oldState.doc.child(i);
                const childEnd = currentPos + child.nodeSize;

                // Check if old position was inside this block
                if (old$anchor.pos >= currentPos && old$anchor.pos < childEnd) {
                  oldTablePos = currentPos;
                  break;
                }

                currentPos = childEnd;
              }

              // Figure out which column we were in
              let oldColumnIndex = -1;
              for (let d = old$anchor.depth; d > 0; d--) {
                const node = old$anchor.node(d);
                if (node.type.name === 'tableRow') {
                  // Found the row, now find which cell we were in
                  const row = node;
                  let cellPos = old$anchor.start(d) + 1; // Start of row + 1
                  for (let i = 0; i < row.childCount; i++) {
                    const cell = row.child(i);
                    if (old$anchor.pos >= cellPos && old$anchor.pos < cellPos + cell.nodeSize) {
                      oldColumnIndex = i;
                      break;
                    }
                    cellPos += cell.nodeSize;
                  }
                  break;
                }
              }


              // Look for table blocks before the current position
              // Since we're at doc level, we need to search the doc's children
              let nodeBefore = null;
              let nodeBeforePos = null;

              // Walk through doc children to find the one before our position
              // Use same logic as general case: when cursor is at start of node, that node IS the target
              currentPos = 0;
              const movingBackward = old$anchor.pos > $anchor.pos;

              for (let i = 0; i < newState.doc.childCount; i++) {
                const child = newState.doc.child(i);
                const childStart = currentPos;
                const childEnd = currentPos + child.nodeSize;

                if (movingBackward) {
                  // Moving backward: node is "before" if its start is <= cursor
                  if (childStart <= $anchor.pos && childEnd > $anchor.pos) {
                    // Cursor is inside/at this node
                    nodeBefore = child;
                    nodeBeforePos = childStart;
                  } else if (childEnd <= $anchor.pos) {
                    // Node completely before cursor
                    nodeBefore = child;
                    nodeBeforePos = childStart;
                  }
                } else {
                  // Moving forward
                  if (childEnd <= $anchor.pos) {
                    nodeBefore = child;
                    nodeBeforePos = childStart;
                  }
                }

                currentPos = childEnd;
              }



              // Only enter the table if it's DIFFERENT from the one we just exited
              if (nodeBefore && nodeBeforePos !== null &&
                isTableBlock(nodeBefore) &&
                nodeBeforePos !== oldTablePos) {

                // We already know where the table starts
                const tableStart = nodeBeforePos;

                if (tableStart !== null) {
                  // Find the last row of this table
                  let lastRowNode = null;
                  let lastRowStart = null;

                  nodeBefore.descendants((node, pos) => {
                    if (node.type.name === 'tableRow') {
                      lastRowNode = node;
                      lastRowStart = tableStart + pos;
                    }
                  });


                  if (lastRowNode && lastRowStart !== null && oldColumnIndex >= 0) {
                    // Find the cell at the same column index
                    let targetCell = null;
                    let cellIndex = 0;
                    let cellPos = lastRowStart + 1;

                    for (let i = 0; i < lastRowNode.childCount; i++) {
                      const cell = lastRowNode.child(i);
                      if (i === oldColumnIndex) {
                        targetCell = cell;
                        // Find last inline position in this cell
                        for (let p = cellPos + cell.nodeSize - 1; p > cellPos; p--) {
                          try {
                            const $pos = newState.doc.resolve(p);
                            if ($pos.parent.isTextblock && $pos.parent.type.spec.content?.includes('inline')) {
                              return newState.tr.setSelection(TextSelection.create(newState.doc, p));
                            }
                          } catch (e) { }
                        }
                        break;
                      }
                      cellPos += cell.nodeSize;
                    }
                  }

                  // Fallback: search backwards from end of table to find last inline position
                  for (let pos = tableStart + nodeBefore.nodeSize - 1; pos > tableStart; pos--) {
                    try {
                      const $pos = newState.doc.resolve(pos);
                      if ($pos.parent.isTextblock && $pos.parent.type.spec.content?.includes('inline')) {
                        return newState.tr.setSelection(TextSelection.create(newState.doc, pos));
                      }
                    } catch (e) { }
                  }
                }
              }
            }

            // General case: If we exited any block and landed at doc level,
            // check what block is at our current position and navigate into it
            if ((wasInTableCell || wasInCodeBlock || parent.type.name === 'doc') && isInvalidPosition) {

              // First, figure out which block we just exited from
              let oldBlockPos = null;
              let currentPos = 0;
              for (let i = 0; i < oldState.doc.childCount; i++) {
                const child = oldState.doc.child(i);
                const childEnd = currentPos + child.nodeSize;

                // Check if old position was inside this block
                if (old$anchor.pos >= currentPos && old$anchor.pos < childEnd) {
                  oldBlockPos = currentPos;
                  break;
                }

                currentPos = childEnd;
              }

              // Determine movement direction
              const movingBackward = old$anchor.pos > $anchor.pos;

              // Find blocks adjacent to current position
              let nodeBeforePos = null;
              let nodeBefore = null;
              let nodeAfterPos = null;
              let nodeAfter = null;

              currentPos = 0;
              const allNodes = [];
              for (let i = 0; i < newState.doc.childCount; i++) {
                const child = newState.doc.child(i);
                const childStart = currentPos;
                const childEnd = currentPos + child.nodeSize;

                allNodes.push({
                  index: i,
                  type: child.type.name,
                  start: childStart,
                  end: childEnd,
                  isTable: isTableBlock(child),
                });

                // When moving backward and cursor is exactly at the start of a node,
                // that node should be considered as "before" (the target to enter)
                // When moving forward, use the standard logic

                if (movingBackward) {
                  // Moving backward: node is "before" if its start is <= cursor
                  if (childStart <= $anchor.pos && childEnd > $anchor.pos) {
                    // Cursor is inside this node - this is the one we're in/at
                    nodeBefore = child;
                    nodeBeforePos = childStart;
                  } else if (childEnd <= $anchor.pos) {
                    // Node completely before cursor
                    nodeBefore = child;
                    nodeBeforePos = childStart;
                  }
                } else {
                  // Moving forward: use standard logic
                  if (childEnd <= $anchor.pos) {
                    nodeBefore = child;
                    nodeBeforePos = childStart;
                  } else if (childStart >= $anchor.pos && !nodeAfter) {
                    nodeAfter = child;
                    nodeAfterPos = childStart;
                  }
                }

                currentPos = childEnd;
              }

              // Choose which block to enter based on movement direction
              let targetNode = null;
              let targetPos = null;
              let enterAtEnd = false;

              if (movingBackward && nodeBefore && nodeBeforePos !== oldBlockPos) {
                // Moving backward - enter previous block at end
                targetNode = nodeBefore;
                targetPos = nodeBeforePos;
                enterAtEnd = true;
              } else if (!movingBackward && nodeAfter && nodeAfterPos !== oldBlockPos) {
                // Moving forward - enter next block at start
                targetNode = nodeAfter;
                targetPos = nodeAfterPos;
                enterAtEnd = false;
              } else {
              }

              if (targetNode && targetPos !== null) {
                // If this is a table, navigate into it
                if (isTableBlock(targetNode)) {
                  // Determine which column to enter
                  // If we were in a table, preserve that column
                  // Otherwise, default to leftmost column (column 0)
                  const targetColumnIndex = (wasInTableCell && oldColumnIndex >= 0) ? oldColumnIndex : 0;


                  // Try to navigate to specific column
                  if (targetColumnIndex >= 0) {

                    // Find the appropriate row in the target table
                    let targetRow = null;
                    let targetRowPos = null;

                    targetNode.descendants((node, pos) => {
                      if (node.type.name === 'tableRow') {
                        if (enterAtEnd) {
                          // Moving backward - use last row
                          targetRow = node;
                          targetRowPos = targetPos + pos;
                        } else if (!targetRow) {
                          // Moving forward - use first row
                          targetRow = node;
                          targetRowPos = targetPos + pos;
                        }
                      }
                    });

                    if (targetRow && targetRowPos !== null) {
                      // Try to find the cell at the same column index
                      let cellPos = targetRowPos + 1;
                      let foundCell = false;

                      for (let i = 0; i < targetRow.childCount; i++) {
                        const cell = targetRow.child(i);
                        if (i === targetColumnIndex) {
                          // Found the matching column - navigate to appropriate end
                          const cellStart = cellPos;
                          const cellEnd = cellPos + cell.nodeSize;

                          if (enterAtEnd) {
                            // Enter at end of cell
                            for (let p = cellEnd - 1; p > cellStart; p--) {
                              try {
                                const $pos = newState.doc.resolve(p);
                                if ($pos.parent.isTextblock && $pos.parent.type.spec.content?.includes('inline')) {
                                  return newState.tr.setSelection(TextSelection.create(newState.doc, p));
                                }
                              } catch (e) { }
                            }
                          } else {
                            // Enter at start of cell
                            for (let p = cellStart + 1; p < cellEnd; p++) {
                              try {
                                const $pos = newState.doc.resolve(p);
                                if ($pos.parent.isTextblock && $pos.parent.type.spec.content?.includes('inline')) {
                                  return newState.tr.setSelection(TextSelection.create(newState.doc, p));
                                }
                              } catch (e) { }
                            }
                          }
                          foundCell = true;
                          break;
                        }
                        cellPos += cell.nodeSize;
                      }

                      if (foundCell) {
                        // If we successfully found and entered the cell, we're done
                        // (the return statements above would have fired)
                        // If we reach here, fallback to default behavior below
                      }
                    }
                  }

                  // Fallback: enter at first/last position (no column preservation)
                  if (enterAtEnd) {
                    // Navigate to last inline position
                    for (let pos = targetPos + targetNode.nodeSize - 1; pos > targetPos; pos--) {
                      try {
                        const $pos = newState.doc.resolve(pos);
                        if ($pos.parent.isTextblock && $pos.parent.type.spec.content?.includes('inline')) {
                          return newState.tr.setSelection(TextSelection.create(newState.doc, pos));
                        }
                      } catch (e) { }
                    }
                  } else {
                    // Navigate to first inline position
                    for (let pos = targetPos + 1; pos < targetPos + targetNode.nodeSize; pos++) {
                      try {
                        const $pos = newState.doc.resolve(pos);
                        if ($pos.parent.isTextblock && $pos.parent.type.spec.content?.includes('inline')) {
                          return newState.tr.setSelection(TextSelection.create(newState.doc, pos));
                        }
                      } catch (e) { }
                    }
                  }
                }

                // If this is a CodeMirror block, we need to focus it via DOM
                if (codeBlockTypes.includes(targetNode.type.name)) {
                  const direction = enterAtEnd ? 'end' : 'start';
                  pendingCodeMirrorFocus = {
                    pos: targetPos,
                    targetNode: targetNode,
                    direction
                  }
                  return newState.tr
                    .setMeta('focusCodeMirror', { pos: targetPos, direction });
                }
              }
            }

            // Try to find nearest valid position (for any invalid position, not just tables)
            let targetPos = null;

            // Determine direction of movement based on old and new positions
            const movingBackward = old$anchor.pos > $anchor.pos;

            if (movingBackward) {
              // Search backward first when moving up/left
              for (let pos = $anchor.pos - 1; pos > 0; pos--) {
                try {
                  const $pos = newState.doc.resolve(pos);
                  if ($pos.parent.isTextblock && $pos.parent.type.spec.content?.includes('inline')) {
                    targetPos = pos;
                    break;
                  }
                } catch (e) { }
              }

              // If not found backward, search forward
              if (targetPos === null) {
                for (let pos = $anchor.pos; pos < newState.doc.content.size; pos++) {
                  try {
                    const $pos = newState.doc.resolve(pos);
                    if ($pos.parent.isTextblock && $pos.parent.type.spec.content?.includes('inline')) {
                      targetPos = pos;
                      break;
                    }
                  } catch (e) { }
                }
              }
            } else {
              // Search forward first when moving down/right
              for (let pos = $anchor.pos; pos < newState.doc.content.size; pos++) {
                try {
                  const $pos = newState.doc.resolve(pos);
                  if ($pos.parent.isTextblock && $pos.parent.type.spec.content?.includes('inline')) {
                    targetPos = pos;
                    break;
                  }
                } catch (e) { }
              }

              // If not found forward, search backward
              if (targetPos === null) {
                for (let pos = $anchor.pos - 1; pos > 0; pos--) {
                  try {
                    const $pos = newState.doc.resolve(pos);
                    if ($pos.parent.isTextblock && $pos.parent.type.spec.content?.includes('inline')) {
                      targetPos = pos;
                      break;
                    }
                  } catch (e) { }
                }
              }
            }

            if (targetPos !== null) {
              return newState.tr.setSelection(TextSelection.create(newState.doc, targetPos));
            }
          }

          return null;
        },

        view: (editorView) => {
          let lastFocusedPos = -1; // Track to avoid re-focusing on same position

          return {
            update: (view, prevState) => {
              const { state } = view;
              const { selection } = state;
              const { $anchor } = selection;

              // Check if selection changed
              if (prevState && state.selection.eq(prevState.selection)) {
                return;
              }


              // Check if we're right before or after a CodeMirror block
              const codeBlockTypes = [
                'codeBlock', 'json_body', 'xml_body', "gqlquery", "gqlbody", "gqlvariables",
                'request-headers', 'response-headers', 'response-body'
              ];

              // Check the node at current position
              const $pos = $anchor;


              let targetCodeMirror = null;
              let direction = 'start';
              let blockPos = -1;

              // Determine movement direction based on previous state
              const movingForward = !prevState || $anchor.pos >= prevState.selection.$anchor.pos;

              // If we just moved and we're adjacent to a CodeMirror block, focus it
              if (pendingCodeMirrorFocus && codeBlockTypes.includes(pendingCodeMirrorFocus.targetNode.type.name)) {
                targetCodeMirror = pendingCodeMirrorFocus.targetNode;
                // If moving forward (down/right), start at beginning; if backward (up/left), start at end
                direction = pendingCodeMirrorFocus.direction;
                blockPos = pendingCodeMirrorFocus.pos;
              }

              if (targetCodeMirror) {
                // Find the position of this CodeMirror block
                // Avoid re-focusing the same position
                if (blockPos === lastFocusedPos) {
                  return;
                }

                try {
                  const domNode = view.nodeDOM(blockPos);
                  if (domNode) {
                    // Don't focus CodeMirror blocks that are inside linked blocks
                    // Linked blocks are read-only previews and should not be focused
                    const isInsideLinkedBlock = (domNode as HTMLElement).closest('[data-linked-block]');
                    if (isInsideLinkedBlock) {
                      return;
                    }
                    const cmEditor = (domNode as HTMLElement).querySelector('.cm-editor') as any;
                    if (cmEditor && cmEditor.cmView) {
                      isSettingCodeMirrorFocus = true;
                      // Only set lastFocusedPos after we successfully find the CodeMirror
                      lastFocusedPos = blockPos;

                      requestAnimationFrame(() => {
                        setTimeout(() => {
                          cmEditor.cmView.focus();
                          const docLength = cmEditor.cmView.state.doc.length;
                          const cursorPos = direction === 'start' ? 0 : Math.max(0, docLength);
                          cmEditor.cmView.dispatch({
                            selection: { anchor: cursorPos, head: cursorPos },
                            scrollIntoView: true
                          });
                        });
                        // Reset after a delay to allow future navigations to the same position
                        setTimeout(() => {
                          lastFocusedPos = -1;
                        }, 100);
                        setTimeout(() => {
                          isSettingCodeMirrorFocus = false;
                        }, 50);
                      })

                    } else {
                      isSettingCodeMirrorFocus = false;
                    }
                  } else {
                    isSettingCodeMirrorFocus = false;
                  }
                } catch (e) {
                  console.error('[SeamlessNav view.update] Error focusing CodeMirror:', e);
                }
              }
            }
          };
        },

        // No props - we're not handling keyboard events directly
        // The appendTransaction above handles seamless navigation
      }),
    ];
  },
});
