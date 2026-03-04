/**
 * Collapsible token result display with copy buttons.
 */
import React, { useState } from "react";
import type { OAuth2TokenResponse } from "../lib/oauth2/types";

interface OAuth2TokenDisplayProps {
  token: OAuth2TokenResponse | null;
  expiresAt?: number; // unix timestamp ms
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
      className="ml-2 px-1.5 py-0.5 text-[10px] font-mono rounded bg-panel hover:bg-active text-comment hover:text-text transition-colors"
      title="Copy to clipboard"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function TokenRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-comment whitespace-nowrap min-w-[100px]">
        {label}:
      </span>
      <span className="text-text break-all font-mono flex-1">{value}</span>
      <CopyButton text={value} />
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
      <div className="border border-red-500/30 rounded px-3 py-2 mt-2 bg-red-500/5">
        <span className="text-xs text-red-400 font-mono">{error}</span>
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
    <div className="border border-stone-700/50 rounded mt-2 text-xs">
      <div
        className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-active/50 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="text-comment font-mono">Token Result</span>
        <div className="flex items-center gap-2">
          <CopyButton text={token.accessToken} />
          <span className="text-comment text-[10px]">
            {collapsed ? "+" : "-"}
          </span>
        </div>
      </div>
      {!collapsed && (
        <div className="px-3 py-2 border-t border-stone-700/50 space-y-0.5">
          <TokenRow label="access_token" value={token.accessToken} />
          <TokenRow label="token_type" value={token.tokenType} />
          {expiresLabel && (
            <TokenRow label="expires_in" value={expiresLabel} />
          )}
          {token.refreshToken && (
            <TokenRow label="refresh_token" value={token.refreshToken} />
          )}
          {token.scope && <TokenRow label="scope" value={token.scope} />}
        </div>
      )}
    </div>
  );
};
