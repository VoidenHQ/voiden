/**
 * HTTP Request Node Converters
 *
 * Utilities for converting data to Tiptap/ProseMirror node structures
 * for HTTP requests (method, URL, headers, etc.)
 */

import { Editor, JSONContent } from "@tiptap/core";

/**
 * REST API request node types
 */
export const REQUEST_NODES = [
  "method",
  "url",
  "headers-table",
  "query-table",
  "url-table",
  "multipart-table",
  "cookies-table",
  "json_body",
  "xml_body",
  "yml_body",
  "pre_request_block",
  "post_request_block",
  "documentation",
];

type OneDimensionalArray = any[];
type TwoDimensionalArray = OneDimensionalArray[];

/**
 * Convert 2D array to table node structure
 */
export const convertDataToTableNode = (data: TwoDimensionalArray) => {
  return [
    {
      type: "table",
      content: data.map((row: OneDimensionalArray) => {
        return {
          type: "tableRow",
          attrs: {
            disabled: false,
          },
          content: row.map((col) => {
            return {
              type: "tableCell",
              attrs: {
                colspan: 1,
                rowspan: 1,
                colwidth: null,
              },
              content: [
                {
                  type: "paragraph",
                  content: col
                    ? [
                        {
                          type: "text",
                          text: col,
                        },
                      ]
                    : [],
                },
              ],
            };
          }),
        };
      }),
    },
  ];
};

/**
 * Create HTTP method node
 */
export const convertToMethodNode = (method?: string) => {
  return {
    type: "method",
    attrs: {
      method: method || "GET",
    },
    content: [
      {
        type: "text",
        text: method,
      },
    ],
  };
};

/**
 * Create URL node
 */
export const convertToURLNode = (url?: string) => {
  return {
    type: "url",
    content: [
      {
        type: "text",
        text: url,
      },
    ],
  };
};

/**
 * Create headers table node
 */
export const convertToHeadersTableNode = (data: TwoDimensionalArray) => {
  return {
    type: "headers-table",
    content: convertDataToTableNode(data),
  };
};

/**
 * Create query params table node
 */
export const convertToQueryTableNode = (data: TwoDimensionalArray) => {
  return {
    type: "query-table",
    content: convertDataToTableNode(data),
  };
};

/**
 * Create multipart table node
 */
export const convertToMultipartTableNode = (data: TwoDimensionalArray) => {
  return {
    type: "multipart-table",
    content: convertDataToTableNode(data),
  };
};

/**
 * Create cookies table node
 */
export const convertToCookiesTableNode = (data: TwoDimensionalArray) => {
  return {
    type: "cookies-table",
    content: convertDataToTableNode(data),
  };
};

/**
 * Create URL-encoded table node (application/x-www-form-urlencoded)
 */
export const convertToUrlTableNode = (data: TwoDimensionalArray) => {
  return {
    type: "url-table",
    content: convertDataToTableNode(data),
  };
};

/**
 * Prettify JSON string to multi-line format
 * This ensures proper YAML serialization with |- block style
 */
const prettifyJson = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

/**
 * Create JSON body node
 */
export const convertToJsonNode = (text: string, contentType: string) => {
  return {
    type: "json_body",
    attrs: {
      importedFrom: "",
      body: prettifyJson(text),
      contentType,
    },
  };
};

/**
 * Create XML body node
 */
export const convertToXMLNode = (text: string, contentType: string) => {
  return {
    type: "xml_body",
    attrs: {
      importedFrom: "",
      body: text,
      contentType,
    },
  };
};

/**
 * Create YAML body node
 */
export const convertToYmlNode = (text: string, contentType: string) => {
  return {
    type: "yml_body",
    attrs: {
      importedFrom: "",
      body: text,
      contentType,
    },
  };
};

/**
 * Get focused child index in editor
 */
export const getFocusedChildIndex = (editor: Editor) => {
  const selectedNode = editor.state.selection.$head.node(1);
  const directChildNodes = (editor.$doc.node.content as any)?.content;
  return directChildNodes.findIndex((item: any) => item === selectedNode) || directChildNodes.length - 1;
};

/**
 * Update editor content with transformation function
 */
type EditorContentUpdater = (content: JSONContent[]) => JSONContent[];

export const updateEditorContent = (editor: Editor, updateContent: EditorContentUpdater) => {
  const editorJson = editor.getJSON();
  const editorJsonContent = editorJson.content || [];

  try {
    editor
      .chain()
      .setContent(
        {
          ...editorJson,
          content: updateContent(editorJsonContent),
        },
        true,
      )
      .run();
  } catch (error) {
    // console.debug(error);
  }
};

/**
 * Replace node of specific type
 */
export const replaceNode = (editorContent: JSONContent[], nodeType: string, nodeContent: JSONContent): JSONContent[] => {
  return editorContent.map((node) => (node.type === nodeType && !node.attrs?.importedFrom ? nodeContent : node));
};

/**
 * Add node at specific index
 */
export const addNode = (editorContent: JSONContent[], nodeContent: JSONContent, addIndex?: number): JSONContent[] => {
  if (addIndex) {
    return [...editorContent.slice(0, addIndex), nodeContent, ...editorContent.slice(addIndex)];
  }
  return [...editorContent, nodeContent];
};

/**
 * Find and replace node or add if not exists
 */
export const findAndReplaceOrAddNode = (
  editorContent: JSONContent[],
  nodeType: string,
  nodeContent: JSONContent,
  addIndex?: number,
): JSONContent[] => {
  const existingNodes = editorContent.filter((node) => node.type === nodeType);
  const existingDocNode = existingNodes?.find((node) => !node.attrs?.importedFrom);
  if (existingDocNode) {
    return replaceNode(editorContent, nodeType, nodeContent);
  } else {
    return addNode(editorContent, nodeContent, addIndex);
  }
};

/**
 * Insert paragraph after request blocks for better formatting
 */
export const insertParagraphAfterRequestBlocks = (editorContentJson: JSONContent[]) => {
  const paragraphNode = {
    type: "paragraph",
  };

  const result = [];

  for (let i = 0; i < editorContentJson.length; i++) {
    const node = editorContentJson[i];
    result.push(node);

    // If request block node, add paragraph after
    if (REQUEST_NODES.filter((n) => !["method", "url"].includes(n)).includes(node.type || "")) {
      result.push(paragraphNode);
    }
  }

  return result;
};
