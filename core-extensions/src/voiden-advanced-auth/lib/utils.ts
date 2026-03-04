/**
 * Utility functions for Advanced Authentication extension
 */

import { Editor } from '@tiptap/core';
import { AuthType } from '../nodes/AuthNode';

// Get default table rows for each auth type
export const getAuthTableRows = (authType: AuthType): string[][] => {
  switch (authType) {
    case "inherit":
    case "none":
      return []; // No table for inherit/none

    case "bearer":
      return [["token", ""]];

    case "basic":
      return [
        ["username", ""],
        ["password", ""]
      ];

    case "apiKey":
      return [
        ["key", ""],
        ["value", ""],
        ["add_to", "header"]
      ];

    case "oauth2":
      // OAuth2 uses the rich panel (OAuth2Panel) instead of table rows.
      // Table is cleared when switching to oauth2; pipeline reads from oauth2Config attrs.
      return [];

    case "oauth1":
      return [
        ["consumer_key", ""],
        ["consumer_secret", ""],
        ["access_token", ""],
        ["token_secret", ""],
        ["signature_method", "HMAC-SHA1"]
      ];

    case "digest":
      return [
        ["username", ""],
        ["password", ""],
        ["realm", ""],
        ["algorithm", "MD5"]
      ];

    case "ntlm":
      return [
        ["username", ""],
        ["password", ""],
        ["domain", ""],
        ["workstation", ""]
      ];

    case "awsSignature":
      return [
        ["access_key", ""],
        ["secret_key", ""],
        ["region", "us-east-1"],
        ["service", "execute-api"]
      ];

    case "hawk":
      return [
        ["hawk_id", ""],
        ["hawk_key", ""],
        ["algorithm", "sha256"]
      ];

    case "atlassianAsap":
      return [
        ["issuer", ""],
        ["subject", ""],
        ["audience", ""],
        ["key_id", ""],
        ["private_key", ""]
      ];

    case "netrc":
      return [
        ["machine", ""],
        ["login", ""],
        ["password", ""]
      ];

    default:
      return [];
  }
};

/**
 * Insert an auth node with a pre-filled table based on auth type
 */
export const insertAuthNode = (editor: Editor, authType: AuthType) => {
  const { from, to } = editor.state.selection;
  const existingNodes = editor.$nodes("auth");
  const existingNode = existingNodes?.find((node: any) => !node.attributes.importedFrom);

  if (existingNode) {
    // If auth node exists, just focus on it
    editor.chain().focus(existingNode.pos).deleteRange({ from, to }).run();
  } else {
    const rows = getAuthTableRows(authType);

    // Insert auth node
    editor.chain().focus().deleteRange({ from, to }).insertContent({
      type: "auth",
      attrs: { authType },
      content: rows.length > 0 ? [{
        type: "table",
        content: rows.map(([key, value]) => ({
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { readonly: true }, // Make the key column readonly
              content: [{ type: "paragraph", content: [{ type: "text", text: key }] }]
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: value ? [{ type: "text", text: value }] : [] }]
            }
          ]
        }))
      }] : []
    }).run();
  }
};
