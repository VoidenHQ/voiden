/**
 * Main OAuth2 configuration panel.
 * Renders grant type selector, dynamic config fields, Get Token button,
 * and token display. Replaces the simple table for oauth2 auth type.
 */

// Use (window as any).electron to access the Electron preload API
// without conflicting with other extensions' declare global blocks.

import React, { useState, useCallback } from "react";
import type {
  OAuth2Config,
  OAuth2GrantType,
  OAuth2TokenResponse,
  OAuth2AddTokenTo,
} from "../lib/oauth2/types";
import { DEFAULT_OAUTH2_CONFIG, GRANT_TYPE_LABELS } from "../lib/oauth2/types";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from "../lib/oauth2/pkce";
import { OAuth2GrantFields } from "./OAuth2GrantFields";
import { OAuth2TokenDisplay } from "./OAuth2TokenDisplay";
import { OAuth2GetTokenButton } from "./OAuth2GetTokenButton";

interface OAuth2PanelProps {
  config: OAuth2Config;
  onConfigChange: (config: OAuth2Config) => void;
  disabled?: boolean;
}

const selectClass =
  "text-xs font-mono bg-bg text-text border border-stone-700/50 rounded px-2 py-1 focus:outline-none focus:border-accent transition-colors";

const labelClass = "block text-xs text-comment mb-0.5";

export const OAuth2Panel: React.FC<OAuth2PanelProps> = ({
  config,
  onConfigChange,
  disabled,
}) => {
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<OAuth2TokenResponse | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);

  const updateField = useCallback(
    (key: keyof OAuth2Config, value: string | boolean) => {
      onConfigChange({ ...config, [key]: value });
    },
    [config, onConfigChange],
  );

  /**
   * Save token to runtime variables (.voiden/.process.env.json)
   */
  const saveTokenToVariables = useCallback(
    async (tokenResponse: OAuth2TokenResponse) => {
      try {
        const prefix = config.variablePrefix || "oauth2";
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

        // Read existing vars, merge, write back
        const existing = await (window as any).electron?.variables?.read();
        const merged = { ...(existing || {}), ...vars };
        await (window as any).electron?.variables?.writeVariables(
          JSON.stringify(merged, null, 2),
        );
      } catch (err) {
        console.error("Failed to save OAuth2 tokens to runtime variables:", err);
      }
    },
    [config.variablePrefix],
  );

  /**
   * Execute the appropriate OAuth2 flow based on grant type.
   */
  const handleGetToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    setToken(null);

    try {
      let result: OAuth2TokenResponse;

      switch (config.grantType) {
        case "authorization_code": {
          const codeVerifier = generateCodeVerifier();
          const codeChallenge = await generateCodeChallenge(codeVerifier);
          const state = generateState();

          result = await (window as any).electron!.oauth2!.startAuthCodeFlow({
            authUrl: config.authUrl,
            tokenUrl: config.tokenUrl,
            clientId: config.clientId,
            clientSecret: config.clientSecret || undefined,
            scope: config.scope,
            callbackUrl: config.callbackUrl || undefined,
            codeVerifier,
            codeChallenge,
            codeChallengeMethod: "S256",
            state,
          });
          break;
        }
        case "implicit": {
          const state = generateState();
          result = await (window as any).electron!.oauth2!.startImplicitFlow({
            authUrl: config.authUrl,
            clientId: config.clientId,
            scope: config.scope,
            callbackUrl: config.callbackUrl || undefined,
            state,
          });
          break;
        }
        case "password": {
          result = await (window as any).electron!.oauth2!.passwordGrant({
            tokenUrl: config.tokenUrl,
            clientId: config.clientId,
            clientSecret: config.clientSecret || undefined,
            username: config.username,
            password: config.password,
            scope: config.scope,
          });
          break;
        }
        case "client_credentials": {
          result = await (window as any).electron!.oauth2!.clientCredentialsGrant({
            tokenUrl: config.tokenUrl,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            scope: config.scope,
          });
          break;
        }
        default:
          throw new Error(`Unsupported grant type: ${config.grantType}`);
      }

      setToken(result);
      await saveTokenToVariables(result);
    } catch (err: any) {
      setError(err.message || "Failed to obtain token");
    } finally {
      setLoading(false);
    }
  }, [config, saveTokenToVariables]);

  const handleCancel = useCallback(async () => {
    try {
      await (window as any).electron?.oauth2?.cancelFlow();
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  return (
    <div className="px-3 py-2 space-y-2 text-xs font-mono">
      {/* Top row: Grant Type, Add Token To, Header Prefix, Auto Refresh */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Grant Type</label>
          <select
            value={config.grantType}
            onChange={(e) =>
              updateField("grantType", e.target.value as OAuth2GrantType)
            }
            disabled={disabled}
            className={`w-full ${selectClass}`}
          >
            {Object.entries(GRANT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Add Token To</label>
          <select
            value={config.addTokenTo}
            onChange={(e) =>
              updateField("addTokenTo", e.target.value as OAuth2AddTokenTo)
            }
            disabled={disabled}
            className={`w-full ${selectClass}`}
          >
            <option value="header">Header</option>
            <option value="query">Query Param</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Header Prefix</label>
          <input
            type="text"
            value={config.headerPrefix}
            onChange={(e) => updateField("headerPrefix", e.target.value)}
            disabled={disabled}
            className={`w-full ${selectClass}`}
            placeholder="Bearer"
          />
        </div>
        <div>
          <label className={labelClass}>Variable Prefix</label>
          <input
            type="text"
            value={config.variablePrefix}
            onChange={(e) => updateField("variablePrefix", e.target.value)}
            disabled={disabled}
            className={`w-full ${selectClass}`}
            placeholder="oauth2"
          />
        </div>
      </div>

      <div className="flex items-center pb-0.5">
        <label className="flex items-center gap-1.5 text-xs text-text cursor-pointer select-none">
          <input
            type="checkbox"
            checked={config.autoRefresh}
            onChange={(e) => updateField("autoRefresh", e.target.checked)}
            disabled={disabled}
            className="rounded border-stone-700/50"
          />
          Auto Refresh
        </label>
      </div>

      {/* Separator */}
      <div className="border-t border-stone-700/30" />

      {/* Dynamic grant-type fields */}
      <div className="space-y-1.5">
        <OAuth2GrantFields
          config={config}
          onChange={updateField}
          disabled={disabled}
        />
      </div>

      {/* Get Token button */}
      <OAuth2GetTokenButton
        loading={loading}
        onGetToken={handleGetToken}
        onCancel={handleCancel}
        disabled={disabled}
      />

      {/* Token display */}
      <OAuth2TokenDisplay token={token} expiresAt={expiresAt} error={error} />
    </div>
  );
};
