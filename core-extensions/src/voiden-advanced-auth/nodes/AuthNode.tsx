import { mergeAttributes, Node, NodeViewProps } from "@tiptap/core";
import { NodeViewContent, ReactNodeViewRenderer } from "@tiptap/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuthTableRows, getOAuth2TableRows } from "../lib/utils";
import { Row, SelectRow, CheckboxRow } from "../components/OAuth2Row";
import { OAuth2GetTokenButton } from "../components/OAuth2GetTokenButton";
import { OAuth2TokenDisplay } from "../components/OAuth2TokenDisplay";
import type { OAuth2Config, OAuth2GrantType, OAuth2TokenResponse, OAuth2AddTokenTo, OAuth2ClientAuthMethod } from "../lib/oauth2/types";
import { DEFAULT_OAUTH2_CONFIG, GRANT_TYPE_LABELS } from "../lib/oauth2/types";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from "../lib/oauth2/pkce";

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

const grantTypeOptions = Object.entries(GRANT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const addTokenToOptions = [
  { value: "header", label: "Header" },
  { value: "query", label: "Query Param" },
];

const clientAuthOptions = [
  { value: "client_secret_post", label: "Credentials in Body" },
  { value: "client_secret_basic", label: "Basic Auth Header" },
];

const EXT_IPC = 'ext:voiden-advanced-auth:';
const ipc = (ch: string, ...args: any[]) => (window as any).electron?.ipc?.invoke(`${EXT_IPC}${ch}`, ...args);

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

    // ── OAuth2 State ──────────────────────────────────────────────────
    const [loading, setLoading] = useState(false);
    const tokenFlowInFlightRef = useRef(false);
    const [token, setToken] = useState<OAuth2TokenResponse | null>(null);
    const [expiresAt, setExpiresAt] = useState<number | undefined>();
    const [error, setError] = useState<string | null>(null);
    const [discovering, setDiscovering] = useState(false);

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
      (key: keyof OAuth2Config, value: string | boolean) => {
        const newConfig = { ...oauth2Config, [key]: value };
        updateAttributes({ oauth2Config: JSON.stringify(newConfig) });
      },
      [oauth2Config, updateAttributes],
    );

    // ── Table Value Helpers ───────────────────────────────────────────

    /** Read key-value pairs from the ProseMirror table inside this node */
    const getTableValues = useCallback((): Record<string, string> => {
      const values: Record<string, string> = {};
      node.content.forEach((child: any) => {
        if (child.type.name === "table") {
          child.content.forEach((row: any) => {
            if (row.type.name === "tableRow") {
              const cells: any[] = [];
              row.content.forEach((cell: any) => cells.push(cell));
              if (cells.length >= 2) {
                const key = cells[0].textContent.trim().toLowerCase();
                const val = cells[1].textContent.trim();
                if (key) values[key] = val;
              }
            }
          });
        }
      });
      return values;
    }, [node]);

    /** Replace the table content inside this node with new rows */
    const rebuildTable = useCallback((rows: string[][]) => {
      const pos = getPos();
      if (typeof pos !== "number") return;
      const contentStart = pos + 1;
      const contentEnd = pos + node.nodeSize - 1;
      const tableContent = rows.length > 0 ? [{
        type: "table",
        content: rows.map(([key, value]) => ({
          type: "tableRow",
          content: [
            { type: "tableCell", attrs: { readonly: true }, content: [{ type: "paragraph", content: [{ type: "text", text: key }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: value ? [{ type: "text", text: value }] : [] }] },
          ],
        })),
      }] : [];
      if (contentEnd > contentStart) {
        editor.chain().deleteRange({ from: contentStart, to: contentEnd }).insertContentAt(contentStart, tableContent).run();
      } else {
        editor.chain().insertContentAt(contentStart, tableContent).run();
      }
    }, [editor, getPos, node]);

    // ── Auto-populate / migrate OAuth2 table ─────────────────────────
    // If the table is missing or has old-format keys (access_token, token_type),
    // rebuild it with the correct grant-type rows, migrating values from oauth2Config.
    const didPopulate = useRef(false);
    useEffect(() => {
      if (authType !== "oauth2" || didPopulate.current) return;

      const expectedRows = getOAuth2TableRows(oauth2Config.grantType);
      const expectedKeys = new Set(expectedRows.map(([k]) => k));
      const currentValues = getTableValues();
      const currentKeys = new Set(Object.keys(currentValues));

      // Check if table already has the expected keys
      const hasExpectedKeys = [...expectedKeys].some((k) => currentKeys.has(k));
      if (hasExpectedKeys) return;

      didPopulate.current = true;

      // Map oauth2Config attribute keys → table row keys for migration
      const configToTable: Record<string, string> = {
        authUrl: "auth_url",
        tokenUrl: "token_url",
        clientId: "client_id",
        clientSecret: "client_secret",
        scope: "scope",
        callbackUrl: "callback_url",
        username: "username",
        password: "password",
      };
      const migratedValues: Record<string, string> = {};
      for (const [configKey, tableKey] of Object.entries(configToTable)) {
        const val = (oauth2Config as any)[configKey];
        if (val) migratedValues[tableKey] = val;
      }

      const filledRows = expectedRows.map(([key, def]) => [key, migratedValues[key] || def]);
      setTimeout(() => rebuildTable(filledRows), 0);
    }, [authType, oauth2Config, node, rebuildTable, getTableValues]);

    // ── OAuth2 Grant Type Change ──────────────────────────────────────

    const handleGrantTypeChange = useCallback((newGrantType: string) => {
      // Read current values to preserve common fields
      const currentValues = getTableValues();
      // Update the config attribute
      const newConfig = { ...oauth2Config, grantType: newGrantType as OAuth2GrantType };
      updateAttributes({ oauth2Config: JSON.stringify(newConfig) });
      // Get new rows and fill in preserved values
      const newRows = getOAuth2TableRows(newGrantType);
      const filledRows = newRows.map(([key, def]) => [key, currentValues[key] || def]);
      rebuildTable(filledRows);
    }, [oauth2Config, updateAttributes, getTableValues, rebuildTable]);

    // ── OIDC Discovery ──────────────────────────────────────────────
    const handleDiscover = useCallback(async () => {
      const tableValues = getTableValues();
      const issuerUrl = tableValues.auth_url || "";
      if (!issuerUrl) {
        setError("Enter an issuer URL in auth_url first");
        return;
      }
      setDiscovering(true);
      setError(null);
      try {
        const config = await ipc('oauth2:discover', { issuerUrl });

        // Build updated rows from current table, replacing discovered values
        const currentValues = getTableValues();
        if (config.authorization_endpoint) {
          currentValues.auth_url = String(config.authorization_endpoint);
        }
        if (config.token_endpoint) {
          currentValues.token_url = String(config.token_endpoint);
        }
        if (config.scopes_supported && !currentValues.scope) {
          const scopes = config.scopes_supported as string[];
          const common = ["openid", "profile", "email"];
          const subset = common.filter((s) => scopes.includes(s));
          currentValues.scope = subset.length > 0 ? subset.join(" ") : scopes.slice(0, 5).join(" ");
        }

        // Rebuild the table with updated values
        const expectedRows = getOAuth2TableRows(oauth2Config.grantType);
        const filledRows = expectedRows.map(([key, def]) => [key, currentValues[key] || def]);
        rebuildTable(filledRows);
      } catch (err: any) {
        setError(err.message || "Discovery failed");
      } finally {
        setDiscovering(false);
      }
    }, [getTableValues, oauth2Config.grantType, rebuildTable]);

    // ── Resolve {{process.xxx}} patterns using runtime variables ─────
    const resolveProcessVars = async (text: string): Promise<string> => {
      if (!text || !text.includes("{{process.")) return text;
      try {
        const variables = await (window as any).electron?.variables?.read() || {};
        return text.replace(/{{\s*process\.([^}]+)\s*}}/g, (_match, varPath) => {
          const value = variables[varPath.trim()];
          if (value !== undefined && value !== null) {
            return typeof value === "object" ? JSON.stringify(value) : String(value);
          }
          return _match;
        });
      } catch {
        return text;
      }
    };

    // ── OAuth2 Token Acquisition ──────────────────────────────────────

    const saveTokenToVariables = useCallback(
      async (tokenResponse: OAuth2TokenResponse) => {
        try {
          const prefix = oauth2Config.variablePrefix || "oauth2";
          const vars: Record<string, unknown> = {
            [`${prefix}_access_token`]: tokenResponse.accessToken,
            [`${prefix}_token_type`]: tokenResponse.tokenType,
          };
          if (tokenResponse.refreshToken) {
            vars[`${prefix}_refresh_token`] = tokenResponse.refreshToken;
          }
          if (tokenResponse.expiresIn) {
            const expAt = Date.now() + tokenResponse.expiresIn * 1000;
            vars[`${prefix}_expires_at`] = expAt;
            setExpiresAt(expAt);
          }
          // Save all extra fields from the raw response (id_token, custom claims, etc.)
          const knownKeys = new Set(["access_token", "token_type", "expires_in", "refresh_token", "scope"]);
          if (tokenResponse.raw) {
            for (const [key, value] of Object.entries(tokenResponse.raw)) {
              if (!knownKeys.has(key) && value != null && value !== "") {
                vars[`${prefix}_${key}`] = typeof value === "object" ? JSON.stringify(value) : value;
              }
            }
          }
          if (oauth2Config.autoRefresh) {
            const tableValues = getTableValues();
            vars[`${prefix}_refresh_config`] = JSON.stringify({
              tokenUrl: tableValues.token_url || "",
              clientId: tableValues.client_id || "",
              clientSecret: tableValues.client_secret || "",
              scope: tableValues.scope || "",
              variablePrefix: prefix,
              clientAuthMethod: oauth2Config.clientAuthMethod || "client_secret_post",
              customParams: oauth2Config.customParams || "",
            });
          }
          const existing = await (window as any).electron?.variables?.read();
          const merged = { ...(existing || {}), ...vars };
          await (window as any).electron?.variables?.writeVariables(
            JSON.stringify(merged, null, 2),
          );
        } catch (err) {
          console.error("Failed to save OAuth2 tokens to runtime variables:", err);
        }
      },
      [oauth2Config.variablePrefix, oauth2Config.autoRefresh, getTableValues],
    );

    const handleGetToken = useCallback(async () => {
      if (tokenFlowInFlightRef.current) {
        return;
      }
      tokenFlowInFlightRef.current = true;
      const rawValues = getTableValues();
      setLoading(true);
      setError(null);
      setToken(null);

      // Resolve {{process.xxx}} patterns in all table values
      const tableValues: Record<string, string> = {};
      for (const [key, val] of Object.entries(rawValues)) {
        tableValues[key] = await resolveProcessVars(val);
      }

      try {
        let result: OAuth2TokenResponse;
        switch (oauth2Config.grantType) {
          case "authorization_code": {
            if (!tableValues.auth_url) throw new Error("Auth URL is required");
            if (!tableValues.token_url) throw new Error("Token URL is required");
            if (!tableValues.client_id) throw new Error("Client ID is required");
            const codeVerifier = generateCodeVerifier();
            const codeChallenge = await generateCodeChallenge(codeVerifier);
            const state = tableValues.state || generateState();
            result = await ipc('oauth2:startAuthCodeFlow', {
              authUrl: tableValues.auth_url || "",
              tokenUrl: tableValues.token_url || "",
              clientId: tableValues.client_id || "",
              clientSecret: tableValues.client_secret || undefined,
              scope: tableValues.scope || "",
              callbackUrl: tableValues.callback_url || undefined,
              codeVerifier,
              codeChallenge,
              codeChallengeMethod: "S256",
              state,
              clientAuthMethod: oauth2Config.clientAuthMethod,
              customParams: oauth2Config.customParams,
            });
            break;
          }
          case "implicit": {
            if (!tableValues.auth_url) throw new Error("Auth URL is required");
            if (!tableValues.client_id) throw new Error("Client ID is required");
            const state = tableValues.state || generateState();
            result = await ipc('oauth2:startImplicitFlow', {
              authUrl: tableValues.auth_url || "",
              clientId: tableValues.client_id || "",
              scope: tableValues.scope || "",
              callbackUrl: tableValues.callback_url || undefined,
              state,
              clientAuthMethod: oauth2Config.clientAuthMethod,
              customParams: oauth2Config.customParams,
            });
            break;
          }
          case "password": {
            if (!tableValues.token_url) throw new Error("Token URL is required");
            if (!tableValues.client_id) throw new Error("Client ID is required");
            result = await ipc('oauth2:passwordGrant', {
              tokenUrl: tableValues.token_url || "",
              clientId: tableValues.client_id || "",
              clientSecret: tableValues.client_secret || undefined,
              username: tableValues.username || "",
              password: tableValues.password || "",
              scope: tableValues.scope || "",
              clientAuthMethod: oauth2Config.clientAuthMethod,
              customParams: oauth2Config.customParams,
            });
            break;
          }
          case "client_credentials": {
            if (!tableValues.token_url) throw new Error("Token URL is required");
            if (!tableValues.client_id) throw new Error("Client ID is required");
            result = await ipc('oauth2:clientCredentialsGrant', {
              tokenUrl: tableValues.token_url || "",
              clientId: tableValues.client_id || "",
              clientSecret: tableValues.client_secret || "",
              scope: tableValues.scope || "",
              clientAuthMethod: oauth2Config.clientAuthMethod,
              customParams: oauth2Config.customParams,
            });
            break;
          }
          default:
            throw new Error(`Unsupported grant type: ${oauth2Config.grantType}`);
        }

        setToken(result);
        await saveTokenToVariables(result);
      } catch (err: any) {
        setError(err.message || "Failed to obtain token");
      } finally {
        tokenFlowInFlightRef.current = false;
        setLoading(false);
      }
    }, [oauth2Config, getTableValues, saveTokenToVariables]);

    const handleCancel = useCallback(async () => {
      try {
        await ipc('oauth2:cancelFlow');
      } catch { /* ignore */ }
      tokenFlowInFlightRef.current = false;
      setLoading(false);
    }, []);

    // ── Auth Type Change ──────────────────────────────────────────────

    const handleAuthTypeChange = (newAuthType: AuthType) => {
      const attrs: Record<string, unknown> = { authType: newAuthType };

      // Initialize oauth2Config when switching to oauth2
      if (newAuthType === "oauth2") {
        attrs.oauth2Config = JSON.stringify(DEFAULT_OAUTH2_CONFIG);
      }

      updateAttributes(attrs);

      // Replace the table content with the correct fields for the new auth type
      const rows = getAuthTableRows(newAuthType);
      const pos = getPos();

      if (typeof pos === 'number') {
        const newContent = rows.length > 0 ? [{
          type: "table",
          content: rows.map(([key, value]) => ({
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { readonly: true },
                content: [{ type: "paragraph", content: [{ type: "text", text: key }] }]
              },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: value ? [{ type: "text", text: value }] : [] }]
              }
            ]
          }))
        }] : [];

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

    // ── Render ────────────────────────────────────────────────────────

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

      // OAuth2: hybrid view — config controls + TipTap table + actions
      if (authType === "oauth2") {
        const showDiscover = oauth2Config.grantType === "authorization_code" || oauth2Config.grantType === "implicit";
        return (
          <div className="text-sm font-mono">
            {/* Always visible: grant_type + auto_refresh */}
            <SelectRow
              k="grant_type"
              value={oauth2Config.grantType}
              onChange={(v) => handleGrantTypeChange(v)}
              options={grantTypeOptions}
              disabled={!isEditable}
            />
            <CheckboxRow
              k="auto_refresh"
              checked={oauth2Config.autoRefresh ?? true}
              onChange={(v) => handleOAuth2ConfigChange("autoRefresh", v)}
              disabled={!isEditable}
            />

            {/* Separator */}
            <div className="border-t border-border" />

            {/* TipTap table with grant-specific fields */}
            <div
              className="w-full max-w-full"
              contentEditable={isEditable}
              suppressContentEditableWarning
              style={{ pointerEvents: !isEditable ? "none" : "unset" }}
            >
              <NodeViewContent />
            </div>

            {/* Separator */}
            <div className="border-t border-border" />

            {/* Action bar: Advanced toggle (left) + Discover/Get Token buttons (right) */}
            <div className="px-2 py-1.5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => handleOAuth2ConfigChange("advancedOpen", !oauth2Config.advancedOpen)}
                className="text-xs font-mono text-comment hover:text-text transition-colors select-none"
              >
                {oauth2Config.advancedOpen ? "▾" : "▸"} Advanced
              </button>
              <div className="flex items-center gap-1.5">
                {showDiscover && (
                  <button
                    type="button"
                    onClick={handleDiscover}
                    disabled={!isEditable || discovering}
                    className="px-2 py-0.5 text-xs font-mono border border-stone-700/50 rounded text-comment hover:text-text hover:border-stone-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {discovering ? (
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        Discovering…
                      </span>
                    ) : (
                      "Discover"
                    )}
                  </button>
                )}
                {loading ? (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-2 py-0.5 text-xs font-mono border border-stone-700/50 rounded text-comment hover:text-text hover:border-stone-600 transition-colors"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleGetToken}
                    disabled={!isEditable}
                    className="px-2 py-0.5 text-xs font-mono border border-stone-700/50 rounded text-comment hover:text-text hover:border-stone-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Get Token
                  </button>
                )}
              </div>
            </div>

            {/* Collapsible advanced section */}
            {oauth2Config.advancedOpen && (
              <div>
                <div className="border-t border-border" />
                <SelectRow
                  k="add_token_to"
                  value={oauth2Config.addTokenTo}
                  onChange={(v) => handleOAuth2ConfigChange("addTokenTo", v as OAuth2AddTokenTo)}
                  options={addTokenToOptions}
                  disabled={!isEditable}
                />
                <Row
                  k="header_prefix"
                  value={oauth2Config.headerPrefix}
                  onChange={(v) => handleOAuth2ConfigChange("headerPrefix", v)}
                  placeholder="Bearer"
                  disabled={!isEditable}
                />
                <Row
                  k="variable_prefix"
                  value={oauth2Config.variablePrefix}
                  onChange={(v) => handleOAuth2ConfigChange("variablePrefix", v)}
                  placeholder="oauth2"
                  disabled={!isEditable}
                />
                <SelectRow
                  k="client_auth"
                  value={oauth2Config.clientAuthMethod}
                  onChange={(v) => handleOAuth2ConfigChange("clientAuthMethod", v as OAuth2ClientAuthMethod)}
                  options={clientAuthOptions}
                  disabled={!isEditable}
                />
                <Row
                  k="extra_params"
                  value={oauth2Config.customParams}
                  onChange={(v) => handleOAuth2ConfigChange("customParams", v)}
                  placeholder="key=value&key2=value2"
                  disabled={!isEditable}
                />
              </div>
            )}

            {/* Token Display */}
            {(token || error) && (
              <div className="px-2 py-1.5">
                <OAuth2TokenDisplay token={token} expiresAt={expiresAt} error={error} />
              </div>
            )}
          </div>
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
