import { Placeholder } from "./Placeholder";

// 0-indexed column of the cell containing `pos`, or -1 if not inside a tableRow.
const getColumnIndexAtPos = (doc: any, pos: number): number => {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "tableRow") {
      return $pos.index(d);
    }
  }
  return -1;
};

export const CustomPlaceholder = Placeholder.configure({
  includeChildren: true,
  placeholder: ({ editor, node, pos }) => {
    const nodeAtPos = editor.$pos(pos);

    if (nodeAtPos.parent?.node.type.name === "tableRow") {
      // Key/Value columns stay unlabeled (position makes their purpose obvious),
      // but Description (column 2+, issue #261) isn't self-evident, so hint it.
      const columnIndex = getColumnIndexAtPos(editor.state.doc, pos);
      return columnIndex >= 2 ? "Description" : "";
    }

    switch (node.type.name) {
      case "method":
        return "GET";
      case "title":
        return "Untitled";
      case "url":
        return "https://echo.apyhub.com/";
      case "heading":
        return `Heading ${node.attrs.level}`;
      case "paragraph":
        return "Write something, or press '/' for commands. Or just paste a curl.";
      case "create":
        return "untitled.yml";
      default:
        return "";
    }
  },
});
