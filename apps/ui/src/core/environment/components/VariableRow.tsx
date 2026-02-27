import { useRef, useEffect } from "react";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import { handleTreeKeyDown } from "./envNavigation";
import { Tip } from "@/core/components/ui/Tip";

interface VariableRowProps {
  varKey: string;
  value: string;
  isPrivate: boolean;
  autoFocusKey?: boolean;
  onChangeKey: (newKey: string) => void;
  onChangeValue: (newValue: string) => void;
  onTogglePrivate: () => void;
  onDelete: () => void;
  onAddNext?: () => void;
}

export const VariableRow = ({
  varKey,
  value,
  isPrivate,
  autoFocusKey = false,
  onChangeKey,
  onChangeValue,
  onTogglePrivate,
  onDelete,
  onAddNext,
}: VariableRowProps) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocusKey) {
      keyRef.current?.focus();
    }
  }, [autoFocusKey]);

  const handleRowKeyDown = (e: React.KeyboardEvent) => {
    if (!rowRef.current) return;
    if (handleTreeKeyDown(e, rowRef.current, null)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      keyRef.current?.focus();
      keyRef.current?.select();
    }
  };

  const handleKeyInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      valueRef.current?.focus();
      valueRef.current?.select();
    }
  };

  const handleValueInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAddNext?.();
    }
  };

  return (
    <div
      ref={rowRef}
      data-env-item
      tabIndex={-1}
      onKeyDown={handleRowKeyDown}
      className="flex items-center gap-2 group outline-none rounded -mx-1 px-1 focus:bg-active"
    >
      <input
        ref={keyRef}
        type="text"
        value={varKey}
        onChange={(e) => onChangeKey(e.target.value)}
        onKeyDown={handleKeyInputKeyDown}
        placeholder="KEY"
        className="flex-1 min-w-0 px-2 py-1 text-sm bg-transparent border border-transparent rounded text-text placeholder:text-comment focus:outline-none focus:bg-editor focus:border-border focus:ring-1"
        style={{ '--tw-ring-color': 'var(--icon-primary)' } as React.CSSProperties}
      />
      <input
        ref={valueRef}
        type="text"
        value={value}
        onChange={(e) => onChangeValue(e.target.value)}
        onKeyDown={handleValueInputKeyDown}
        placeholder="value"
        className="flex-[2] min-w-0 px-2 py-1 text-sm bg-transparent border border-transparent rounded text-text placeholder:text-comment focus:outline-none focus:bg-editor focus:border-border focus:ring-1"
        style={{ '--tw-ring-color': 'var(--icon-primary)' } as React.CSSProperties}
      />
      <Tip label={isPrivate ? "Private (env-private.yaml) — click to make public" : "Public (env-public.yaml) — click to make private"}>
        <button
          onClick={onTogglePrivate}
          tabIndex={-1}
          className="p-1 rounded hover:bg-active transition-colors flex-shrink-0"
        >
          {isPrivate ? (
            <Lock size={14} style={{ color: 'var(--icon-warning)' }} />
          ) : (
            <LockOpen size={14} className="text-comment" />
          )}
        </button>
      </Tip>
      <Tip label="Delete variable">
        <button
          onClick={onDelete}
          tabIndex={-1}
          className="p-1 rounded hover:bg-active transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
        >
          <Trash2 size={14} style={{ color: 'var(--icon-error)' }} />
        </button>
      </Tip>
    </div>
  );
};
