/**
 * Token result display with copy buttons, matching table row pattern.
 */
import React, { useState } from "react";
import type { OAuth2TokenResponse } from "../lib/oauth2/types";

interface OAuth2TokenDisplayProps {
  token: OAuth2TokenResponse | null;
  expiresAt?: number;
  error?: string | null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 px-1.5 py-0.5 text-[10px] font-mono rounded bg-panel hover:bg-active text-comment hover:text-text transition-colors"
      title="Copy to clipboard"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function TokenRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex hover:bg-muted/50 transition-colors">
      <div className="p-1 px-2 h-6 flex items-center text-sm font-mono text-comment whitespace-nowrap border-r border-border shrink-0" style={{ width: 130 }}>
        {label}
      </div>
      <div className="p-1 px-2 h-6 flex items-center text-sm font-mono text-text w-full min-w-0">
        <span className="truncate flex-1">{value}</span>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

export const OAuth2TokenDisplay: React.FC<OAuth2TokenDisplayProps> = ({
  token,
  expiresAt,
  error,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  if (error) {
    return (
      <div className="mt-1.5 px-2 py-1 text-sm font-mono text-red-400">
        {error}
      </div>
    );
  }

  if (!token) return null;

  const expiresLabel = (() => {
    if (!token.expiresIn) return undefined;
    const expAt = expiresAt || Date.now() + token.expiresIn * 1000;
    const expDate = new Date(expAt);
    const isExpired = Date.now() > expAt;
    return `${token.expiresIn}s${isExpired ? " (expired)" : ` (expires ${expDate.toLocaleTimeString()})`}`;
  })();

  return (
    <div className="mt-1.5">
      <div
        className="flex items-center justify-between px-2 h-6 cursor-pointer hover:bg-muted/50 transition-colors border-t border-border"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="text-sm font-mono text-comment">token_result</span>
        <div className="flex items-center gap-2">
          <CopyButton text={token.accessToken} />
          <span className="text-comment text-[10px]">
            {collapsed ? "+" : "-"}
          </span>
        </div>
      </div>
      {!collapsed && (
        <div>
          <TokenRow label="access_token" value={token.accessToken} />
          <TokenRow label="token_type" value={token.tokenType} />
          {expiresLabel && <TokenRow label="expires_in" value={expiresLabel} />}
          {token.refreshToken && <TokenRow label="refresh_token" value={token.refreshToken} />}
          {token.scope && <TokenRow label="scope" value={token.scope} />}
          {/* Extra fields from raw response (id_token, custom claims, etc.) */}
          {token.raw && (() => {
            const known = new Set(["access_token", "token_type", "expires_in", "refresh_token", "scope"]);
            return Object.entries(token.raw)
              .filter(([k, v]) => !known.has(k) && v != null && v !== "")
              .map(([k, v]) => (
                <TokenRow key={k} label={k} value={typeof v === "object" ? JSON.stringify(v) : String(v)} />
              ));
          })()}
        </div>
      )}
    </div>
  );
};
