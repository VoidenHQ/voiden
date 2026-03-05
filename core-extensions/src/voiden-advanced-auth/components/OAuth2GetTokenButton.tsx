/**
 * "Get Token" button with loading/cancel states.
 */
import React from "react";

interface OAuth2GetTokenButtonProps {
  loading: boolean;
  onGetToken: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export const OAuth2GetTokenButton: React.FC<OAuth2GetTokenButtonProps> = ({
  loading,
  onGetToken,
  onCancel,
  disabled,
}) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-1">
        <button
          onClick={onCancel}
          className="px-2.5 py-0.5 text-xs font-mono rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 border border-red-500/30 transition-colors"
        >
          Cancel
        </button>
        <span className="text-xs text-comment font-mono animate-pulse">
          Waiting for authorization...
        </span>
      </div>
    );
  }

  return (
    <div className="py-1">
      <button
        onClick={onGetToken}
        disabled={disabled}
        className="px-2.5 py-0.5 text-xs font-mono rounded bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Get Token
      </button>
    </div>
  );
};
