import { Editor, Node, NodeViewProps, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Play, Copy, Check } from "lucide-react";
import { useState } from "react";
import { generateGrpcurlFromJson } from '../lib/grpcurlGenerator';
import { generateWebsocatFromJson } from '../lib/websocatGenerator';
import { activeWsConnections, closeAllActiveWsConnections } from './MessagesNode';

// function to prevent enter key from creating a new line when in method node
const preventEnter = (editor: Editor) => {
  const node = editor.state.selection.$head.node();

  if (node?.type.name === "smethod") {
    const pos = editor.$node("surl")?.to;
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

// Factory function to create MethodNode with context hooks for sockets
export const createSocketMethodNode = (useSendRestRequest: any) => {
  const MethodNodeView = (props: NodeViewProps) => {
    const { node, editor, getPos } = props;
    const { refetch } = useSendRestRequest(editor);
    const [copied, setCopied] = useState(false);

    const method = node.attrs.method;
    const isGrpc = /^grpcs?$/i.test(method);

    if (!node.attrs.visible) {
      return <NodeViewWrapper></NodeViewWrapper>;
    }

    const handleCopy = async () => {
      try {
        const smethodPos = typeof getPos === 'function' ? getPos() ?? 0 : 0;

        // Split top-level doc nodes into sections separated by request-separator
        const sections: { nodes: any[]; offsets: number[] }[] = [];
        let currentNodes: any[] = [];
        let currentOffsets: number[] = [];

        editor.state.doc.forEach((child: any, offset: number) => {
          if (child.type.name === 'request-separator') {
            sections.push({ nodes: currentNodes, offsets: currentOffsets });
            currentNodes = [];
            currentOffsets = [];
          } else {
            currentNodes.push(child);
            currentOffsets.push(offset);
          }
        });
        sections.push({ nodes: currentNodes, offsets: currentOffsets });

        // Find the section whose node range contains smethodPos
        let sectionContent: any[] = [];
        for (const section of sections) {
          const found = section.offsets.some((offset, i) =>
            smethodPos >= offset && smethodPos < offset + section.nodes[i].nodeSize
          );
          if (found) {
            sectionContent = section.nodes.map((n: any) => n.toJSON());
            break;
          }
        }

        if (!sectionContent.length) return;

        // Wrap the full section as a scoped doc — generators call getRequest internally
        const scopedDoc = { type: 'doc', content: sectionContent };

        const raw = isGrpc
          ? await generateGrpcurlFromJson(scopedDoc)
          : await generateWebsocatFromJson(scopedDoc);

        if (!raw) return;
        const resolved = await (window as any).electron?.env?.replaceVariables(raw) ?? raw;
        await navigator.clipboard.writeText(resolved);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Error copying command:', err);
      }
    };

    return (
      <NodeViewWrapper>
        <div className="flex justify-between" contentEditable={false}>
          <span className="m-0 font-mono my-0 font-semibold text-green-500 select-none" style={{ userSelect: 'none' }}>
            {method}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="flex items-center justify-center w-7 h-7 rounded-md border hover:bg-hover text-comment hover:text-text transition-colors"
              onClick={handleCopy}
              title={isGrpc ? "Copy as grpcurl" : "Copy as websocat"}
              style={{ borderColor: 'var(--ui-line)', cursor: 'pointer', userSelect: 'none' }}
            >
              {copied ? <Check size={12} className="text-status-success" /> : <Copy size={12} />}
            </button>
            <div
              className="border-x border-border border-t p-1 hover:bg-stone-700 cursor-pointer text-http-get"
              onClick={async () => {
                if (activeWsConnections.size > 0) {
                  const ok = window.confirm('An active connection exists. It will be closed to reconnect. Continue?');
                  if (!ok) return;
                  await closeAllActiveWsConnections();
                }
                refetch();
              }}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <Play size={14} />
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "smethod",
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
          default: "WSS",
        },
        importedFrom: {
          default: "",
        },
        visible: {
          default: true,
        },
      };
    },
    parseHTML() {
      return [
        {
          tag: "smethod",
        },
      ];
    },

    renderHTML({ HTMLAttributes, node }) {
      return node.attrs.visible
        ? [
            "smethod",
            mergeAttributes(HTMLAttributes, {
              class: `m-0 font-mono my-0 font-semibold text-http-get`,
            }),
            0,
          ]
        : ["smethod", mergeAttributes(HTMLAttributes, { class: "hidden bg-red-400" }), 0];
    },
    addNodeView() {
      return ReactNodeViewRenderer(MethodNodeView);
    },
    addKeyboardShortcuts() {
      return {
        // Move down from smethod to surl
        ArrowDown: () => {
          const { $head } = this.editor.state.selection;
          if ($head.parent.type.name === "smethod" && $head.pos === $head.end()) {
            const urlNode = this.editor.$node("surl");
            if (urlNode) {
              this.editor.commands.focus(urlNode.from + 1);
              return true;
            }
          }
          return false;
        },
        // Enter moves to next block after socket-request
        Enter: () => {
          const { $head } = this.editor.state.selection;
          if ($head.parent.type.name === "smethod") {
            const socketRequest = this.editor.$node("surl");
            if (socketRequest) {
              this.editor
                .chain()
                .focus(socketRequest.to)
              return true;
              
            }
          }
          return false;
        },
        "Shift-Enter": () => preventEnter(this.editor),
      };
    },
  });
};

// Export default MethodNode for backward compatibility (stub)
export const SocketMethodNode = createSocketMethodNode(() => ({
  refetch: () => console.warn('[SocketMethodNode] No useSendRestRequest hook provided'),
  isLoading: false,
  error: null,
  data: null,
  cancelRequest: () => {},
}));
