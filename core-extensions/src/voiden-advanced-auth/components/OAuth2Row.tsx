/**
 * Table-like key-value row matching the ProseMirror table cell pattern.
 * Mimics: h-6, p-1 px-2, border-r between columns, hover:bg-muted/50.
 * Supports {{variable}} syntax highlighting in value inputs.
 */
import React, { useRef } from "react";

const rowClass =
  "flex hover:bg-muted/50 transition-colors";

const keyCellClass =
  "p-1 px-2 h-6 flex items-center text-sm font-mono text-comment whitespace-nowrap border-r border-border shrink-0";

const valueCellClass =
  "p-1 px-2 h-6 flex items-center text-sm font-mono text-text w-full min-w-0";

const selectInputClass =
  "w-full bg-transparent text-sm font-mono text-text outline-none cursor-pointer";

/**
 * Splits a string into segments: plain text and {{variable}} tokens.
 */
function parseVariableSegments(text: string): { text: string; isVar: boolean }[] {
  const segments: { text: string; isVar: boolean }[] = [];
  const regex = /(\{\{[^}]*\}\})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isVar: false });
    }
    segments.push({ text: match[1], isVar: true });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isVar: false });
  }
  return segments;
}

/**
 * Input with {{variable}} highlighting overlay.
 * Renders a transparent input over a div with highlighted spans.
 */
function HighlightedInput({
  value,
  onChange,
  placeholder,
  disabled,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isPassword = type === "password";
  const segments = parseVariableSegments(value);
  const hasVars = segments.some(s => s.isVar);

  // For password fields or values without variables, use plain input
  if (isPassword || !hasVars) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full bg-transparent text-sm font-mono text-text outline-none placeholder:text-comment/40${disabled ? " opacity-50 cursor-not-allowed" : ""}`}
        spellCheck={false}
      />
    );
  }

  return (
    <div className="relative w-full h-full flex items-center overflow-hidden">
      {/* Highlight layer */}
      <div
        className="absolute inset-0 flex items-center pointer-events-none whitespace-nowrap text-sm font-mono"
        aria-hidden="true"
      >
        {segments.map((seg, i) =>
          seg.isVar ? (
            <span
              key={i}
              className="bg-emerald-400/20 text-emerald-300 rounded-sm px-0.5"
            >
              {seg.text}
            </span>
          ) : (
            <span key={i} className="text-transparent">{seg.text}</span>
          ),
        )}
      </div>
      {/* Actual input (transparent text where variables are, visible elsewhere) */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`relative w-full bg-transparent text-sm font-mono text-text outline-none placeholder:text-comment/40 caret-text${disabled ? " opacity-50 cursor-not-allowed" : ""}`}
        spellCheck={false}
        style={{ color: 'transparent' }}
      />
      {/* Non-variable text overlay (visible) */}
      <div
        className="absolute inset-0 flex items-center pointer-events-none whitespace-nowrap text-sm font-mono"
        aria-hidden="true"
      >
        {segments.map((seg, i) =>
          seg.isVar ? (
            <span key={i} className="text-transparent">{seg.text}</span>
          ) : (
            <span key={i} className="text-text">{seg.text}</span>
          ),
        )}
      </div>
    </div>
  );
}

interface RowProps {
  k: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  keyWidth?: number;
}

export const Row: React.FC<RowProps> = ({
  k,
  value,
  onChange,
  placeholder,
  disabled,
  type = "text",
  keyWidth = 130,
}) => (
  <div className={rowClass}>
    <div className={keyCellClass} style={{ width: keyWidth }}>
      {k}
    </div>
    <div className={valueCellClass}>
      <HighlightedInput
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        type={type}
      />
    </div>
  </div>
);

interface SelectRowProps {
  k: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  keyWidth?: number;
}

export const SelectRow: React.FC<SelectRowProps> = ({
  k,
  value,
  onChange,
  options,
  disabled,
  keyWidth = 130,
}) => (
  <div className={rowClass}>
    <div className={keyCellClass} style={{ width: keyWidth }}>
      {k}
    </div>
    <div className={valueCellClass}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`${selectInputClass}${disabled ? " opacity-50 cursor-not-allowed" : ""}`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  </div>
);

interface CheckboxRowProps {
  k: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  keyWidth?: number;
}

export const CheckboxRow: React.FC<CheckboxRowProps> = ({
  k,
  checked,
  onChange,
  disabled,
  keyWidth = 130,
}) => (
  <div className={rowClass}>
    <div className={keyCellClass} style={{ width: keyWidth }}>
      {k}
    </div>
    <div className={valueCellClass}>
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="rounded border-stone-700/50"
        />
        <span className="text-sm font-mono text-text">{checked ? "enabled" : "disabled"}</span>
      </label>
    </div>
  </div>
);
