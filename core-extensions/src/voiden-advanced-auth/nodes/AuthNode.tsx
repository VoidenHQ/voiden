import { mergeAttributes, Node, NodeViewProps } from "@tiptap/core";
import { NodeViewContent, ReactNodeViewRenderer } from "@tiptap/react";
import React, { useCallback, useMemo } from "react";
import { getAuthTableRows } from "../lib/utils";
import { OAuth2Panel } from "../components/OAuth2Panel";
import type { OAuth2Config } from "../lib/oauth2/types";
import { DEFAULT_OAUTH2_CONFIG } from "../lib/oauth2/types";

// Auth type definitions
export type AuthType =
  | "inherit"
  | "none"
  | "bearer"
  | "basic"
  | "apiKey"
  | "oauth2"
  | "oauth1"
  | "digest"
  | "ntlm"
  | "awsSignature"
  | "hawk"
  | "atlassianAsap"
  | "netrc";

// Factory function to create AuthNode with context components
export const createAuthNode = (NodeViewWrapper: any, RequestBlockHeader: any, openFile?: (relativePath: string) => Promise<void>) => {
  const AuthTypeSelector = ({ authType, isEditable, onChange }: { authType: AuthType; isEditable: boolean; onChange: (authType: AuthType) => void }) => {
    return (
      <select
        value={authType}
        onChange={(e) => onChange(e.target.value as AuthType)}
        disabled={!isEditable}
        className="px-2 py-0.5 text-xs font-mono bg-bg border border-stone-700/50 rounded text-text focus:outline-none focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="inherit">Inherit</option>
        <option value="none">No Auth</option>
        <option value="bearer">Bearer Token</option>
        <option value="basic">Basic Auth</option>
        <option value="apiKey">API Key</option>
        <option value="oauth2">OAuth 2.0</option>
        <option value="oauth1">OAuth 1.0</option>
        <option value="digest">Digest</option>
        <option value="ntlm">NTLM</option>
        <option value="awsSignature">AWS</option>
        <option value="hawk">Hawk</option>
        <option value="atlassianAsap">ASAP</option>
        <option value="netrc">Netrc</option>
      </select>
    );
  };

  const AuthNodeView = (props: NodeViewProps) => {
    const { node, updateAttributes, editor, getPos } = props;
    const authType = (node.attrs.authType || "inherit") as AuthType;
    const isImported = !!node.attrs.importedFrom;
    const isEditable = editor.isEditable && !isImported;

    // Parse oauth2Config from node attribute
    const oauth2Config: OAuth2Config = useMemo(() => {
      if (authType !== "oauth2") return DEFAULT_OAUTH2_CONFIG;
      try {
        const raw = node.attrs.oauth2Config;
        if (raw && typeof raw === "string") return { ...DEFAULT_OAUTH2_CONFIG, ...JSON.parse(raw) };
        if (raw && typeof raw === "object") return { ...DEFAULT_OAUTH2_CONFIG, ...raw };
      } catch { /* ignore */ }
      return DEFAULT_OAUTH2_CONFIG;
    }, [authType, node.attrs.oauth2Config]);

    const handleOAuth2ConfigChange = useCallback(
      (newConfig: OAuth2Config) => {
        updateAttributes({ oauth2Config: JSON.stringify(newConfig) });
      },
      [updateAttributes],
    );

    const handleAuthTypeChange = (newAuthType: AuthType) => {
      // Update the auth type attribute
      const attrs: Record<string, unknown> = { authType: newAuthType };

      // Initialize oauth2Config when switching to oauth2
      if (newAuthType === "oauth2") {
        attrs.oauth2Config = JSON.stringify(DEFAULT_OAUTH2_CONFIG);
      }

      updateAttributes(attrs);

      // For oauth2, we don't need table content – the panel renders everything
      if (newAuthType === "oauth2") {
        const pos = getPos();
        if (typeof pos === "number") {
          const contentStart = pos + 1;
          const contentEnd = pos + node.nodeSize - 1;
          if (contentEnd > contentStart) {
            editor.chain().focus().deleteRange({ from: contentStart, to: contentEnd }).run();
          }
        }
        return;
      }

      // Replace the table content with the correct fields for the new auth type
      const rows = getAuthTableRows(newAuthType);
      const pos = getPos();

      if (typeof pos === 'number') {
        // Build the new content for the auth node
        const newContent = rows.length > 0 ? [{
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
        }] : [];

        // Replace the content inside the auth node
        // pos is the start of the node, pos + node.nodeSize is the end
        // We want to replace only the content (not the node itself), so we use pos + 1 to pos + node.nodeSize - 1
        const contentStart = pos + 1;
        const contentEnd = pos + node.nodeSize - 1;

        editor
          .chain()
          .focus()
          .deleteRange({ from: contentStart, to: contentEnd })
          .insertContentAt(contentStart, newContent)
          .run();
      }
    };

    const renderContent = () => {
      if (authType === "inherit") {
        return (
          <div className="px-3 py-3 text-xs font-mono text-comment">
            Inherit auth from parent or collection
          </div>
        );
      }

      if (authType === "none") {
        return (
          <div className="px-3 py-3 text-xs font-mono text-comment">
            No authentication required
          </div>
        );
      }

      // OAuth2: render the rich panel instead of a table
      if (authType === "oauth2") {
        return (
          <OAuth2Panel
            config={oauth2Config}
            onConfigChange={handleOAuth2ConfigChange}
            disabled={!isEditable}
          />
        );
      }

      // For all other types, render the table
      return (
        <div
          className="w-full max-w-full"
          contentEditable={isEditable}
          suppressContentEditableWarning
          style={{
            pointerEvents: !isEditable ? "none" : "unset",
          }}
        >
          <NodeViewContent />
        </div>
      );
    };

    return (
      <NodeViewWrapper spellCheck="false" className="my-2">
        <RequestBlockHeader
          withBorder
          title="HTTP-AUTHORIZATION"
          editor={editor}
          importedDocumentId={node.attrs.importedFrom}
          openFile={openFile}
          actions={
            <AuthTypeSelector
              authType={authType}
              isEditable={isEditable}
              onChange={handleAuthTypeChange}
            />
          }
        />
        {renderContent()}
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "auth",
    group: "block",
    content: "table?", // Optional table content
    atom: false,
    selectable: true,
    draggable: true,

    addAttributes() {
      return {
        authType: {
          default: "inherit",
        },
        importedFrom: {
          default: "",
        },
        oauth2Config: {
          default: "",
        },
      };
    },

    parseHTML() {
      return [{ tag: "auth" }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["auth", mergeAttributes(HTMLAttributes), 0];
    },

    addNodeView() {
      return ReactNodeViewRenderer(AuthNodeView);
    },
  });
};

export const AuthNode = createAuthNode;
