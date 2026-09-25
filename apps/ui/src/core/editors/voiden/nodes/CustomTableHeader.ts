// PROOF OF CONCEPT

import { mergeAttributes } from "@tiptap/core";

import TableHeader from "@tiptap/extension-table-header";

export const CustomTableHeader = TableHeader.extend({
  name: "tableHeader",
  addOptions() {
    return {
      HTMLAttributes: {},
      ...this.parent?.(),
    };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "th",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "text-sm bg-red-400",
      }),
      0,
    ];
  },
});
