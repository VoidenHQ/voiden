import { describe, it, expect } from "vitest";
import { Editor, Node } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Heading from "@tiptap/extension-heading";
import { requestOrchestrator, NotARequestError } from "@/core/request-engine/requestOrchestrator";

/**
 * Reported bug: a .void file with a single request and NO request-separator
 * (the implicit "section 0") fails with "No request blocks found in this
 * section" when run via the Stitch Runner (which always passes an explicit
 * sectionIndex, unlike normal single-request execution by cursor position,
 * which uses sectionPos instead).
 *
 * This isolates requestOrchestrator's own section-scoping — the actual
 * reported failure's error message, NotARequestError, is thrown from
 * there — using a minimal real Editor/schema, independent of the full
 * app/plugin stack. It passes: { sectionIndex: 0 } against a
 * separator-less document correctly includes the request block in the
 * section-scoped JSON handlers receive. That rules this layer out — the
 * bug is elsewhere in the real stack (dynamically-loaded plugin handlers,
 * the stitch-specific linkedBlock/inherited-block expansion, or the
 * headless editor's extension list, which is missing UniqueID/
 * DocumentPreserver compared to the live editor's — see stitchEngine.ts's
 * `allExtensions`). Kept as a regression guard for this layer either way.
 */
const RequestNode = Node.create({
  name: "request",
  group: "block",
  atom: true,
  addAttributes() {
    return { uid: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-request]" }];
  },
  renderHTML() {
    return ["div", { "data-request": "" }];
  },
});

const RequestSeparatorNode = Node.create({
  name: "request-separator",
  group: "block",
  atom: true,
  addAttributes() {
    return { uid: { default: null }, label: { default: null }, colorIndex: { default: 0 } };
  },
  parseHTML() {
    return [{ tag: "div[data-request-separator]" }];
  },
  renderHTML() {
    return ["div", { "data-request-separator": "" }];
  },
});

function buildEditor(content: any) {
  return new Editor({
    extensions: [Document, Paragraph, Text, Heading, RequestNode, RequestSeparatorNode],
    content,
  });
}

describe("requestOrchestrator section scoping — single request, no separator", () => {
  it("finds the request block in section 0 when the document has zero request-separators", async () => {
    const editor = buildEditor({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Get Product" }] },
        { type: "paragraph", content: [{ type: "text", text: "Fetches a single product." }] },
        { type: "request", attrs: { uid: "ca5c8f24-8ed7-4a7a-8de2-d058a604923b" } },
      ],
    });

    let sawRequestNodeInScopedJson = false;
    const handler = (req: any, ed: any) => {
      const json = ed.getJSON();
      sawRequestNodeInScopedJson = !!json.content?.some((n: any) => n.type === "request");
      return sawRequestNodeInScopedJson ? { ...req, url: "http://test.invalid" } : req;
    };
    requestOrchestrator.registerRequestHandler(handler);

    try {
      await requestOrchestrator.executeRequest(editor, undefined, undefined, { sectionIndex: 0 });
    } catch (err) {
      // A NotARequestError here means section-scoping excluded the request
      // block — that's the actual bug under test. Any other error (e.g. a
      // real network attempt failing) means section-scoping worked fine.
      expect(err).not.toBeInstanceOf(NotARequestError);
    } finally {
      requestOrchestrator.clear();
      editor.destroy();
    }

    expect(sawRequestNodeInScopedJson).toBe(true);
  });
});
