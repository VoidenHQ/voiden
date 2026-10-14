import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { FileLink } from "@/core/editors/voiden/extensions/ExternalFile";

/**
 * Regression test for: clicking to place the cursor next to a fileLink chip
 * (e.g. a file attached to a table cell) and pressing Backspace did nothing
 * on the first press.
 *
 * Root cause: fileLink was `atom: true` but also declared `content: "inline*"`,
 * a combination unique to this node — its sibling atom nodes (linkedBlock,
 * linkedFile) declare no content at all. `content` was never actually
 * populated anywhere (renderHTML/parseHTML don't project children either),
 * so the declaration was vestigial. But it made `fileLink.type.isLeaf` false,
 * which made @tiptap/react's ReactNodeViewRenderer allocate a "content DOM"
 * for it — never attached to the visible DOM since FileLinkNodeView never
 * renders <NodeViewContent> — confusing ProseMirror's click-to-position
 * mapping around the node on the first interaction.
 *
 * The fix removes the stray `content: "inline*"`, making fileLink a true
 * leaf like every other atom node in this schema.
 */
describe("fileLink schema", () => {
  it("is a true ProseMirror leaf (no phantom contentDOM in the NodeView)", () => {
    const editor = new Editor({
      extensions: [Document, Paragraph, Text, FileLink],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "fileLink", attrs: { filePath: "a.txt", filename: "a.txt" } }] },
        ],
      },
    });

    const fileLinkType = editor.schema.nodes.fileLink;
    expect(fileLinkType.isLeaf).toBe(true);

    const node = editor.state.doc.content.firstChild!.firstChild!;
    expect(node.type.name).toBe("fileLink");
    expect(node.nodeSize).toBe(1);

    editor.destroy();
  });
});
