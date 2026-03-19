import { METHOD_COLORS } from "../constants";
import { Editor, Node, NodeViewProps, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Play } from "lucide-react";

// function to prevent enter key from creating a new line when in method node
const preventEnter = (editor: Editor) => {
  const node = editor.state.selection.$head.node();

  if (node?.type.name === "method") {
    const pos = editor.$node("url")?.to;
    if (pos) {
      editor
        .chain()
        .focus(pos - 1)
        .run();
      return true;
    } else {
      return false;
    }
  } else {
    return false;
  }
};

// Factory function to create MethodNode with context hooks
export const createMethodNode = (useSendRestRequest: any) => {
  const MethodNodeView = (props: NodeViewProps) => {
    const { node, editor } = props;
    const { refetch } = useSendRestRequest(editor);

    const method = node.attrs.method;

    if (!node.attrs.visible) {
      return <NodeViewWrapper></NodeViewWrapper>;
    }

    return (
      <NodeViewWrapper>
        <div className="flex items-center gap-2">
          <NodeViewContent
            className={`m-0 font-mono my-0 font-semibold flex-1 ${
              METHOD_COLORS[method?.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"]
            }`}
          />
          <button
            className="flex items-center justify-center w-7 h-7 rounded-md border hover:bg-hover text-status-success transition-colors"
            onClick={() => {
              refetch();
            }}
            style={{ borderColor: 'var(--ui-line)', cursor: 'pointer', userSelect: 'none' }}
          >
            <Play size={12} />
          </button>
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
  name: "method",
  content: "inline*",
  group: "block",
  marks: "",
  addOptions() {
    return {
      shortcut: "Cmd-Shift-M",
    };
  },
  addAttributes() {
    return {
      method: {
        default: "GET",
      },
      importedFrom: {
        default: "",
      },
      visible: {
        default: true,
      },
    };
  },
  onSelectionUpdate() {
    const node = this.editor.state.selection.$head.node();
    if (node?.type.name === "method") {
      const newMethod = this.editor.state.selection.$head.node().textContent;
      const currentMethod = node.attrs.method;
      // Only update if the method has actually changed
      if (newMethod !== currentMethod) {
        this.editor.commands.updateAttributes("method", {
          method: newMethod,
        });
      }
    }
  },
  parseHTML() {
    return [
      {
        tag: "method",
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return node.attrs.visible
      ? [
          "method",
          mergeAttributes(HTMLAttributes, {
            class: `m-0 font-mono my-0 font-semibold ${
              METHOD_COLORS[node.textContent?.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"]
            }`,
          }),
          0,
        ]
      : ["method", mergeAttributes(HTMLAttributes, { class: "hidden bg-red-400" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MethodNodeView);
  },
  addKeyboardShortcuts() {
    return {
      ArrowDown: () => {
        const { $head } = this.editor.state.selection;
        if ($head.parent.type.name === "method" && $head.pos === $head.end()) {
          const nextPos = $head.pos + 1;
          this.editor.commands.setTextSelection(nextPos);
          return true;
        }
        return false;
      },
      "Shift-Enter": () => preventEnter(this.editor),
      Enter: () => preventEnter(this.editor),
    };
  },
  });
};

// Export default MethodNode for backward compatibility (stub)
export const MethodNode = createMethodNode(() => ({
  refetch: () => console.warn('[MethodNode] No useSendRestRequest hook provided'),
  isLoading: false,
  error: null,
  data: null,
  cancelRequest: () => {},
}));
