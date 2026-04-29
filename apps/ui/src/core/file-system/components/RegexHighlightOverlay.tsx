import React, { useMemo } from "react";
import { cn } from "@/core/lib/utils";

type TokenType = "escape" | "bracket" | "group" | "quantifier" | "anchor" | "alternation" | "dot" | "literal";
type Token = { type: TokenType; text: string };

export function tokenizeRegex(pattern: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "\\" && i + 1 < pattern.length) {
      tokens.push({ type: "escape", text: pattern.slice(i, i + 2) });
      i += 2;
    } else if (pattern[i] === "[") {
      let j = i + 1;
      if (j < pattern.length && pattern[j] === "^") j++;
      if (j < pattern.length && pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") {
        if (pattern[j] === "\\" && j + 1 < pattern.length) j++;
        j++;
      }
      tokens.push({ type: "bracket", text: pattern.slice(i, j + 1) });
      i = j + 1;
    } else if (pattern[i] === "(" || pattern[i] === ")") {
      tokens.push({ type: "group", text: pattern[i] });
      i++;
    } else if ("*+?".includes(pattern[i])) {
      let text = pattern[i++];
      if (i < pattern.length && pattern[i] === "?") text += pattern[i++];
      tokens.push({ type: "quantifier", text });
    } else if (pattern[i] === "{") {
      let j = i + 1;
      while (j < pattern.length && pattern[j] !== "}") {
        if (pattern[j] === "\\" && j + 1 < pattern.length) j++;
        j++;
      }
      tokens.push({ type: "quantifier", text: pattern.slice(i, j + 1) });
      i = j + 1;
    } else if (pattern[i] === "^" || pattern[i] === "$") {
      tokens.push({ type: "anchor", text: pattern[i++] });
    } else if (pattern[i] === "|") {
      tokens.push({ type: "alternation", text: pattern[i++] });
    } else if (pattern[i] === ".") {
      tokens.push({ type: "dot", text: pattern[i++] });
    } else {
      let j = i + 1;
      while (j < pattern.length && !"\\[(){}*+?^$.|".includes(pattern[j])) j++;
      tokens.push({ type: "literal", text: pattern.slice(i, j) });
      i = j;
    }
  }
  return tokens;
}

const TOKEN_COLORS: Record<TokenType, string | undefined> = {
  escape: "var(--syntax-keyword)",
  bracket: "var(--syntax-regexp)",
  group: "var(--syntax-func)",
  quantifier: "var(--syntax-keyword)",
  anchor: "var(--syntax-entity)",
  alternation: "var(--syntax-keyword)",
  dot: "var(--syntax-entity)",
  literal: undefined,
};

export function isValidRegex(pattern: string): boolean {
  try { new RegExp(pattern); return true; } catch { return false; }
}

// CSS rule callers inject once to keep selection visible on textareas that
// use `color: transparent` for the regex overlay trick.
export const REGEX_HIGHLIGHT_SELECTION_CSS = `.regex-hl-input::selection { color: var(--fg-primary); }`;

interface RegexHighlightOverlayProps {
  value: string;
  /**
   * Padding / font-size classes must match those of the underlying textarea
   * so tokens line up over the transparent text.
   */
  className?: string;
}

/**
 * Absolutely-positioned backdrop that renders the regex `value` as
 * syntax-colored tokens. Place it as a sibling of a `<textarea>` inside a
 * `position: relative` container; set the textarea's `color` to transparent
 * so only the backdrop's colored tokens are visible.
 */
export function RegexHighlightOverlay({ value, className }: RegexHighlightOverlayProps) {
  const tokens = useMemo(() => tokenizeRegex(value), [value]);
  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-0 overflow-hidden pointer-events-none select-none whitespace-pre-wrap break-words",
        className,
      )}
      style={{ fontFamily: "inherit", letterSpacing: "inherit" }}
    >
      {tokens.map((token, idx) => (
        <span key={idx} style={TOKEN_COLORS[token.type] ? { color: TOKEN_COLORS[token.type] } : undefined}>
          {token.text}
        </span>
      ))}
    </div>
  );
}
