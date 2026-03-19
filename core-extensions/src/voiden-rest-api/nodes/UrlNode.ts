import { Node, mergeAttributes } from "@tiptap/core";

export const UrlNode = Node.create({
  name: "url",
  content: "inline*",
  group: "block",
  marks: "",
  addAttributes() {
    return {};
  },
  parseHTML() {
    return [{ tag: "url" }];
  },
  onCreate() {
    const urlNode = this.editor.$node("url");
    const methodNode = this.editor.$node("method");

    // Auto-focus URL input when it's created and empty (or contains just the placeholder)
    if (urlNode && this.editor.isEditable) {
      const urlText = urlNode.textContent || "";
      // Focus if empty or contains only "https://"
      if (urlText.length === 0 || urlText === "https://") {
        // Position cursor after "https://" if present, otherwise at start
        const offset = urlText === "https://" ? 8 : 0;
        this.editor.commands.focus(urlNode.from + offset);
      }
    }
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "url",
      mergeAttributes(HTMLAttributes, {
        class: "border rounded-md p-2 px-3 font-mono w-full block mb-3 text-sm transition-colors",
        style: "border-color: var(--ui-line);",
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        // first check if currently selected node is a method node
        const node = this.editor.state.selection.$head.node();
        if (node?.type.name === "title") {
          const pos = this.editor.$node("method")?.to;
          if (pos) {
            this.editor
              .chain()
              .focus(pos - 1)
              .run();
            return true;
          } else {
            return false;
          }
        } else if (node?.type.name === "url") {
          const pos = this.editor.$node("url")?.to;
          if (pos) {
            this.editor.chain().focus(pos).insertContent({ type: "paragraph" }).run();
            return true;
          } else {
            return false;
          }
        } else {
          return false;
        }
      },
      "Mod-a": () => {
        const { state, commands } = this.editor;
        const { $from } = state.selection;
        const node = $from.node();

        if (node && node.type.name === "url") {
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
