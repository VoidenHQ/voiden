import { afterEach, describe, expect, it } from "vitest";
import { Editor, Node } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";

import { CustomTable } from "@/core/editors/voiden/nodes/CustomTable";
import { CustomTableRow } from "@/core/editors/voiden/nodes/CustomTableRow";

const HeadersTable = Node.create({
  name: "headers-table",
  group: "block",
  content: "table",
  parseHTML: () => [{ tag: "headers-table" }],
  renderHTML: () => ["headers-table", 0],
});

describe("request table column labels", () => {
  let editor: Editor | undefined;

  afterEach(() => editor?.destroy());

  it("voiden test : renders labels and fields in the same table", () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text, HeadersTable, CustomTable, CustomTableRow, TableCell, TableHeader],
      content: {
        type: "doc",
        content: [
          {
            type: "headers-table",
            content: [
              {
                type: "table",
                content: [
                  {
                    type: "tableRow",
                    content: [
                      { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "X-Test" }] }] },
                      { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "value" }] }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const table = editor.view.dom.querySelector("table");
    const labels = table?.querySelector("tr[data-request-table-labels]");
    const dataRow = table?.querySelector("tr:not([data-request-table-labels])");

    expect(editor.view.dom.querySelectorAll("tr[data-request-table-labels]")).toHaveLength(1);
    expect(labels?.parentElement).toBe(dataRow?.parentElement);
    expect(Array.from(labels?.children ?? []).map((cell) => cell.textContent)).toEqual(["", "Required", "Key", "Value"]);
    expect(dataRow?.children).toHaveLength(4);
    expect((labels?.children[1] as HTMLElement).style.width).toBe("96px");
    expect((labels?.children[1] as HTMLElement).style.whiteSpace).toBe("nowrap");
    expect((dataRow?.children[1] as HTMLElement).style.width).toBe("96px");
  });
});
