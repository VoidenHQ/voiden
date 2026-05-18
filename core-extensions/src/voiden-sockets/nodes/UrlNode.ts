import { Node, mergeAttributes } from "@tiptap/core";

export const SocketUrlNode = Node.create({
  name: "surl",
  content: "inline*",
  group: "block",
  marks: "",
  addAttributes() {
    return {};
  },
  parseHTML() {
    return [{ tag: "surl" }];
  },
  onCreate() {
    const urlNode = this.editor.$node("surl");

    // Auto-focus URL input when it's created and empty (or contains just the placeholder)
    if (urlNode && this.editor.isEditable) {
      const urlText = urlNode.textContent || "";
      // Focus if empty or contains only "wss://" or "grpcs://"
      if (urlText.length === 0 || urlText === "wss://" || urlText === "grpcs://") {
        // Position cursor after protocol if present, otherwise at start
        let offset = 0;
        if (urlText === "wss://") offset = 6;
        else if (urlText === "grpcs://") offset = 8;
        this.editor.commands.focus(urlNode.from + offset);
      }
    }
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "surl",
      mergeAttributes(HTMLAttributes, {
        class: "border border-border p-1 font-mono w-full block mb-4",
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Move up from surl to smethod
      ArrowUp: () => {
        const { $head } = this.editor.state.selection;
        if ($head.parent.type.name === "surl" && $head.pos === $head.start() + 1) {
          const methodNode = this.editor.$node("smethod");
          if (methodNode) {
            this.editor.commands.focus(methodNode.to - 1);
            return true;
          }
        }
        return false;
      },
      
      // Move left from surl to smethod
      ArrowLeft: () => {
        const { $head } = this.editor.state.selection;
        if ($head.parent.type.name === "surl" && $head.pos === $head.start() + 1) {
          const methodNode = this.editor.$node("smethod");
          if (methodNode) {
            this.editor.commands.focus(methodNode.to - 1);
            return true;
          }
        }
        return false;
      },
      
      // Move down from surl - skip proto and go to content after socket-request
      ArrowDown: () => {
        const { $head } = this.editor.state.selection;
        if ($head.parent.type.name === "surl" && $head.pos === $head.end()) {
          const { state } = this.editor;
          const { doc } = state;
          
          // Find the parent socket-request node
          let socketRequestPos = null;
          let socketRequestNode = null;
          
          doc.descendants((node, pos) => {
            if (node.type.name === "socket-request") {
              // Check if surl is a child of this socket-request
              const surlNode = this.editor.$node("surl");
              if (surlNode && pos < surlNode.from && surlNode.from < pos + node.nodeSize) {
                socketRequestPos = pos;
                socketRequestNode = node;
              }
            }
          });
          
          if (socketRequestPos !== null && socketRequestNode !== null) {
            // Position after the entire socket-request node
            const afterSocketRequest = socketRequestPos + (((socketRequestNode as any)?.nodeSize||0) as number);
            const $afterPos = doc.resolve(afterSocketRequest);
            
            if ($afterPos.nodeAfter) {
              // Move to existing next node
              this.editor.commands.focus(afterSocketRequest);
            } else {
              // Insert new paragraph after socket-request
              this.editor
                .chain()
                .insertContentAt(afterSocketRequest, { type: "paragraph" })
                .focus(afterSocketRequest + 1)
                .run();
            }
            return true;
          }
        }
        return false;
      },
      
      // Enter moves to next block after socket-request (skips proto)
      Enter: () => {
        const { $head } = this.editor.state.selection;
        if ($head.parent.type.name === "surl") {
          const { state } = this.editor;
          const { doc } = state;
          
          // Find the parent socket-request node
          let socketRequestPos = null;
          let socketRequestNode = null;
          
          doc.descendants((node, pos) => {
            if (node.type.name === "socket-request") {
              // Check if surl is a child of this socket-request
              const surlNode = this.editor.$node("surl");
              if (surlNode && pos < surlNode.from && surlNode.from < pos + node.nodeSize) {
                socketRequestPos = pos;
                socketRequestNode = node;
              }
            }
          });
          
          if (socketRequestPos !== null && socketRequestNode !== null) {
            // Position after the entire socket-request node
            const afterSocketRequest = socketRequestPos + (((socketRequestNode as any)?.nodeSize ||0) as number);
            const $afterPos = doc.resolve(afterSocketRequest);
            
            if ($afterPos.nodeAfter) {
              // Move to existing next node
              this.editor.commands.focus(afterSocketRequest);
            } else {
              // Insert new paragraph after socket-request
              this.editor
                .chain()
                .insertContentAt(afterSocketRequest, { type: "paragraph" })
                .focus(afterSocketRequest + 1)
                .run();
            }
            return true;
          }
          
        }
        return false;
      },
       Backspace: () => {
        const { state } = this.editor;
        const { $head, empty } = state.selection;
        const { doc } = state;
        
        // Only handle if cursor is at the start of a paragraph and selection is empty
        if (empty && $head.parent.type.name === "paragraph" && $head.pos === $head.start() + 1) {
          const nodeBefore = $head.nodeBefore;
          
          // Check if the previous node is a socket-request
          if (nodeBefore?.type.name === "socket-request") {
            // Find the surl node inside this socket-request
            let surlPos = null;
            nodeBefore.descendants((node, pos, parent) => {
              if (node.type.name === "surl") {
                // Calculate absolute position
                surlPos = $head.pos - 1 + pos;
              }
            });
            
            if (surlPos !== null) {
              // Move cursor to the end of surl
              this.editor.commands.focus(surlPos + 1); // +1 to be inside the node
              return true;
            }
          }
          
          // Also check if we're right after a proto node
          if (nodeBefore?.type.name === "proto") {
            const surlNode = this.editor.$node("surl");
            if (surlNode) {
              this.editor.commands.focus(surlNode.to - 1);
              return true;
            }
          }
        }
        return false;
      },
      "Mod-a": () => {
        const { state, commands } = this.editor;
        const { $from } = state.selection;
        const node = $from.node();

        if (node && node.type.name === "surl") {
          commands.setTextSelection({
            from: $from.start(),
            to: $from.end(),
          });
        } else {
          commands.selectAll();
        }
        return true;
      },
    };
  },
});