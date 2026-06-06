import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/core/editors/code/lib/components/CodeEditor", () => ({
  CodeEditor: () => null,
}));

vi.mock("@/core/editors/voiden/nodes/RequestBlockHeader", () => ({
  RequestBlockHeader: () => null,
}));

vi.mock("@/core/settings/hooks", () => ({
  useSettings: () => ({ settings: {} }),
}));

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CustomCodeBlock } from "@/core/editors/voiden/nodes/CustomCodeBlock";

const TestCustomCodeBlock = CustomCodeBlock.extend({
  addNodeView: undefined,
});

const createEditor = (content: string) =>
  new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      TestCustomCodeBlock,
    ],
    content,
  });

const triggerCodeBlockInputRule = (editor: Editor) => {
  editor.commands.focus("end");
  editor.view.someProp("handleKeyDown", (handler) =>
    handler(
      editor.view,
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
};

describe("CustomCodeBlock input rules", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  it("voiden test : converts ``` + Enter to codeBlock without throwing", () => {
    editor = createEditor("<p>```</p>");

    expect(() => triggerCodeBlockInputRule(editor)).not.toThrow();

    const doc = editor.getJSON();
    expect(doc.content?.[0]?.type).toBe("codeBlock");
    expect(doc.content?.[0]?.attrs?.language).toBe("plaintext");
    expect(doc.content?.[0]?.attrs?.body).toBe("");
  });

  it("voiden test : ```javascript + Enter creates codeBlock with language javascript", () => {
    editor = createEditor("<p>```javascript</p>");

    triggerCodeBlockInputRule(editor);

    const doc = editor.getJSON();
    expect(doc.content?.[0]?.type).toBe("codeBlock");
    expect(doc.content?.[0]?.attrs?.language).toBe("javascript");
    expect(doc.content?.[0]?.attrs?.body).toBe("");
  });
});
