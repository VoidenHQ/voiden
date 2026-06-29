import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Transaction } from "@tiptap/pm/state";
import { v4 as uuidv4 } from "uuid";

interface UniqueIdOptions {
  types: string[];
  attributeName?: string;
  // Node types in this list only receive a uid when they're a direct child
  // of the document, not when nested inside a listItem/blockquote/tableCell
  // etc. Used for generic markdown nodes (paragraph, heading, codeBlock) so
  // list items and quotes don't get individually wrapped into importable
  // blocks — only the equivalent top-level block does.
  requireTopLevel?: string[];
}

const uniqueIdPluginKey = new PluginKey("uniqueIdPlugin");

const UniqueID = Extension.create<UniqueIdOptions>({
  name: "uniqueId",

  addOptions() {
    return {
      types: [],
      attributeName: "uid",
      requireTopLevel: [],
    };
  },

  addGlobalAttributes() {
    const attributeName = this.options.attributeName ?? "uid";

    return (this.options.types || []).map((type) => ({
      types: [type],
      attributes: {
        [attributeName]: {
          default: null,
          renderHTML: (attributes) => {
            const value = (attributes as Record<string, string | null>)[attributeName];
            return value ? { [`data-${attributeName}`]: value } : {};
          },
        },
      },
    }));
  },

  addProseMirrorPlugins() {
    const attributeName = this.options.attributeName ?? "uid";
    const nodeTypes = this.options.types || [];
    const requireTopLevel = this.options.requireTopLevel || [];

    return [
      new Plugin({
        key: uniqueIdPluginKey,
        appendTransaction: (_transactions, _oldState, newState) => {
          let tr: Transaction | null = null;
          const seen = new Set<string>();

          newState.doc.descendants((node, pos) => {
            if (!nodeTypes.includes(node.type.name)) return;

            if (requireTopLevel.includes(node.type.name)) {
              const parent = newState.doc.resolve(pos).parent;
              if (parent.type.name !== "doc") return;
            }

            const existing = (node.attrs as Record<string, string | null | undefined>)[attributeName];

            if (existing && !seen.has(existing)) {
              seen.add(existing);
              return;
            }

            // setNodeMarkup re-validates the node's existing content against
            // its type's content expression (e.g. blockquote/heading require
            // at least one child). A node with structurally invalid content
            // — e.g. an empty blockquote from an old file that was authored
            // before this type was ever subject to this check — would throw
            // a RangeError and crash the whole document load. Skip it rather
            // than assign a uid it can't safely carry.
            if (!node.type.validContent(node.content)) return;

            const uid = uuidv4();
            seen.add(uid);
            tr = tr ?? newState.tr;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attributeName]: uid }, node.marks);
          });

          return tr && tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

export default UniqueID;
