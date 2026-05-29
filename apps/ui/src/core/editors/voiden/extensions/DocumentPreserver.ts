import { Extension } from '@tiptap/core';

/**
 * Extension that preserves unknown nodes during JSON round-trips
 * This ensures that when plugins are disabled, their data is not lost
 */
export const DocumentPreserver = Extension.create({
  name: 'documentPreserver',

  // Override the editor's JSON handling AFTER editor is created
  onCreate() {
    const { editor } = this;

    // Store the original getJSON method
    const originalGetJSON = editor.getJSON.bind(editor);

    // Intercept getJSON to restore original data for placeholder nodes
    editor.getJSON = () => {
      const json = originalGetJSON();
      return restoreOriginalNodes(json, editor.schema);
    };
  },
});

/**
 * Recursively restore original node data for placeholder nodes
 */
function restoreOriginalNodes(node: any, schema: any): any {
  if (!node || typeof node !== 'object') return node;

  // If this node has preserved data, return the original
  if (node.attrs && node.attrs.__preserved) {
    return node.attrs.__preserved;
  }

  // Recursively process content
  if (node.content && Array.isArray(node.content)) {
    return {
      ...node,
      content: node.content.map((child: any) => restoreOriginalNodes(child, schema)),
    };
  }

  return node;
}

/**
 * When loading JSON, wrap unknown nodes with preservation data.
 *
 * Special case: if a known placeholder node has children whose types are not in
 * the schema (e.g. gqlquery containing gqlurl/gqlbody when the GraphQL plugin is
 * disabled), collapse the whole node into __preserved and clear the content.
 * This prevents TipTap from throwing on unknown child types while keeping all
 * data intact for when the plugin is re-enabled.
 */
export function preserveUnknownNodesInJSON(json: any, schema: any): any {
  if (!json || typeof json !== 'object') return json;

  if (json.type && !schema.nodes[json.type]) {
    return {
      type: json.type,
      attrs: { __preserved: json },
    };
  }

  if (json.content && Array.isArray(json.content)) {
    const schemaNode = schema.nodes[json.type];
    const isPlaceholder = schemaNode?.spec?.attrs?.__preserved !== undefined;

    if (isPlaceholder && json.content.some((child: any) => child.type && !schema.nodes[child.type])) {
      // Placeholder node with unknown children — store the entire original node
      // (including its children) in __preserved so nothing is lost on save.
      return {
        type: json.type,
        attrs: { ...(json.attrs ?? {}), __preserved: json },
      };
    }

    return {
      ...json,
      content: json.content.map((child: any) => preserveUnknownNodesInJSON(child, schema)),
    };
  }

  return json;
}
