/**
 * Voiden REST API Slash Commands
 *
 * Slash commands for inserting HTTP request blocks
 */

import { SlashCommandGroup } from '@voiden/sdk';
import { insertRequestTableNode } from './utils';
import { getSectionNodesAtPos } from './sectionUtils';

/**
 * Check if a node type exists in the current section (between request-separator nodes).
 * Falls back to global search if no separators exist.
 */
function findExistingNodeInSection(editor: any, nodeType: string): any | null {
  const doc = editor.state.doc;
  const cursorPos = editor.state.selection.$from.pos;
  const sectionNodes = getSectionNodesAtPos(doc, cursorPos);

  // Check if this node type exists in the current section
  const existsInSection = sectionNodes.some((node: any) => node.type.name === nodeType);
  if (!existsInSection) return null;

  // Find the actual node instance in the current section
  const allNodes = editor.$nodes(nodeType);
  return allNodes?.find((node: any) => !node.attributes.importedFrom) || null;
}

export const restApiSlashGroup: SlashCommandGroup = {
  name: "http",
  title: "REST API Blocks",

  commands: [
    {
      name: "endpoint",
      label: "Endpoint",
      aliases: [],
      singleton: true,
      compareKeys: ["request", "endpoint","socket-request"],
      slash: "/endpoint",
      description: "Insert a method",
      action: (editor) => {
        editor.chain().insertContent({
          type: "request",
          content: [
            {
              type: "method",
              content: [{ type: "text", text: "GET" }],
            },
            {
              type: "url",
              content: [{ type: "text", text: "https://" }],
            },
          ],
        }).run();

        // Focus the URL input after insertion
        setTimeout(() => {
          const urlNode = editor.$node("url");
          if (urlNode && urlNode.textContent === "https://") {
            // Position cursor after "https://"
            editor.commands.focus(urlNode.from + 8); // 8 = length of "https://"
          }
        }, 50);
      },
    },
    {
      name: "headers-table",
      label: "Headers",
      slash: "/headers",
      aliases: [],
      singleton: true,
      compareKeys: ["headers-table"],
      description: "Insert a headers table",
      action: (editor) => {
        const range = {
          from: editor.state.selection.$from.pos,
          to: editor.state.selection.$to.pos,
        };
        insertRequestTableNode(editor, range, "headers-table");
      },
    },
    {
      name: "query-table",
      label: "Query Table",
      slash: "/query",
      aliases: [],
      singleton: true,
      compareKeys: ["query-table"],
      description: "Insert a query table",
      action: (editor) => {
        const range = {
          from: editor.state.selection.$from.pos,
          to: editor.state.selection.$to.pos,
        };
        insertRequestTableNode(editor, range, "query-table");
      },
    },
    {
      name: "multipart-table",
      label: "Multipart Table",
      aliases: [],
      slash: "/multipart",
      singleton: true,
      compareKeys: ["multipart-table"],
      description: "Insert a multipart table",
      action: (editor) => {
        const range = {
          from: editor.state.selection.$from.pos,
          to: editor.state.selection.$to.pos,
        };
        insertRequestTableNode(editor, range, "multipart-table");
      },
    },
    {
      name: "url-table",
      label: "URL Table",
      aliases: [],
      slash: "/url",
      singleton: true,
      compareKeys: ["url-table"],
      description: "Insert a URL table",
      action: (editor) => {
        const range = {
          from: editor.state.selection.$from.pos,
          to: editor.state.selection.$to.pos,
        };
        insertRequestTableNode(editor, range, "url-table");
      },
    },
    {
      name: "cookies-table",
      label: "Cookies",
      slash: "/cookies",
      aliases: [],
      singleton: true,
      compareKeys: ["cookies-table"],
      description: "Insert a cookies table",
      action: (editor) => {
        const range = {
          from: editor.state.selection.$from.pos,
          to: editor.state.selection.$to.pos,
        };
        insertRequestTableNode(editor, range, "cookies-table");
      },
    },
    {
      name: "options-table",
      label: "Options",
      slash: "/options",
      aliases: [],
      singleton: true,
      compareKeys: ["options-table"],
      description: "Insert a request options table",
      action: (editor) => {
        const range = {
          from: editor.state.selection.$from.pos,
          to: editor.state.selection.$to.pos,
        };
        insertRequestTableNode(editor, range, "options-table");
      },
    },
    {
      name: "json",
      label: "JSON",
      aliases: [],
      slash: "/json",
      singleton: true,
      compareKeys: ["json_body"],
      description: "Insert a JSON node",
      action: (editor) => {
        const range = {
          from: editor.state.selection.$from.pos,
          to: editor.state.selection.$to.pos,
        };
        const existingNode = findExistingNodeInSection(editor, "json_body");
        if (existingNode) {
          editor.chain().focus(existingNode.pos).deleteRange(range).run();
        } else {
          editor.storage.json_body.shouldFocusNext = true;
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([{ type: "json_body" }])
            .run();
        }
      },
    },
    {
      name: "xml",
      label: "XML",
      aliases: [],
      slash: "/xml",
      singleton: true,
      compareKeys: ["xml_body"],
      description: "Insert an XML node",
      action: (editor) => {
        const range = {
          from: editor.state.selection.$from.pos,
          to: editor.state.selection.$to.pos,
        };
        const existingNode = findExistingNodeInSection(editor, "xml_body");
        if (existingNode) {
          editor.chain().focus(existingNode.pos).deleteRange(range).run();
        } else {
          editor.storage.xml_body.shouldFocusNext = true;
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([{ type: "xml_body" }])
            .run();
        }
      },
    },
    {
      name: "yml",
      label: "YAML",
      aliases: ["yaml"],
      slash: "/yml",
      singleton: true,
      compareKeys: ["yml_body"],
      description: "Insert a YAML node",
      action: (editor) => {
        const range = {
          from: editor.state.selection.$from.pos,
          to: editor.state.selection.$to.pos,
        };
        const existingNode = findExistingNodeInSection(editor, "yml_body");
        if (existingNode) {
          editor.chain().focus(existingNode.pos).deleteRange(range).run();
        } else {
          editor.storage.yml_body.shouldFocusNext = true;
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([{ type: "yml_body" }])
            .run();
        }
      },
    },
    {
      name: "path-table",
      label: "Path Params",
      slash: "/path-params",
      aliases: ["path-params"],
      singleton: true,
      compareKeys: ["path-table"],
      description: "Insert a path params table",
      action: (editor) => {
        const range = {
          from: editor.state.selection.$from.pos,
          to: editor.state.selection.$to.pos,
        };
        insertRequestTableNode(editor, range, "path-table");
      },
    },
    {
      name: "binary-file",
      label: "Binary File",
      aliases: [],
      slash: "/file",
      description: "Insert a binary file upload",
      action: (editor) => {
        const { from, to } = editor.state.selection;
        editor.chain().focus().deleteRange({ from, to }).insertContent({
          type: "restFile",
          attrs: {
            fieldName: "file",
          },
          content: [],
        }).run();
      },
    },
  ],
};
