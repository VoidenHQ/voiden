import { cn } from "@/core/lib/utils";

interface KbdProps {
  keys: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const MAC_MODIFIER_LABELS: Record<string, string> = {
  "⌘": "Ctrl",
  "⌥": "Alt",
  "⇧": "Shift",
  "⌃": "Ctrl",
};

const MAC_KEY_LABELS: Record<string, string> = {
  "↵": "Enter",
  "⌫": "Backspace",
  "⌦": "Delete",
  "⇥": "Tab",
};

const MAC_SYMBOLS = new Set([...Object.keys(MAC_MODIFIER_LABELS), ...Object.keys(MAC_KEY_LABELS)]);

/**
 * Split a shortcut string into individual key tokens so each key can be
 * rendered as its own separate box, e.g. "⌘⇧P" -> ["⌘", "⇧", "P"].
 *
 * Handles both Mac-symbol shortcuts ("⌘⇧P", the raw form used throughout the
 * app) and pre-converted word shortcuts ("Shift+Ctrl+P", as produced by
 * getShortcutLabel() on non-Mac) — the latter already has "+" separators, so
 * it's just split on that.
 */
const splitIntoTokens = (keys: string): string[] => {
  if (keys.includes("+")) {
    return keys.split("+").filter(Boolean);
  }

  // Mac-symbol form: modifiers are always single characters (⌘⌥⇧⌃), so peel
  // them off one at a time. Whatever's left (could be multi-char, e.g.
  // "ENTER") is the final key and isn't split further.
  const tokens: string[] = [];
  let rest = keys;
  while (rest.length > 0 && MAC_SYMBOLS.has(rest[0])) {
    tokens.push(rest[0]);
    rest = rest.slice(1);
  }
  if (rest) tokens.push(rest);
  return tokens;
};

/**
 * Keyboard shortcut display component. Renders each key in its own separate
 * box (⌘ ⇧ P), matching Cursor/VS Code's shortcut hint style, instead of one
 * box containing the whole combination.
 *
 * @example
 * <Kbd keys="⌘N" />   // [⌘] [N] on Mac, [Ctrl] [N] on Windows/Linux
 * <Kbd keys="⌘⇧P" />  // [⌘] [⇧] [P] on Mac, [Ctrl] [Shift] [P] on Windows/Linux
 */
export const Kbd = ({ keys, className, size = "md" }: KbdProps) => {
  const isMac = navigator?.userAgent?.toLowerCase().includes("mac") ?? false;

  const toDisplayToken = (token: string): string => {
    if (isMac) return token;
    return MAC_MODIFIER_LABELS[token] ?? MAC_KEY_LABELS[token] ?? token;
  };

  const tokens = splitIntoTokens(keys).map(toDisplayToken);

  const sizeClasses = {
    sm: "text-[10px] px-1 py-0.5 min-w-[16px]",
    md: "text-xs px-1.5 py-0.5 min-w-[18px]",
    lg: "text-sm px-2 py-1 min-w-[22px]",
  };

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {tokens.map((token, i) => (
        <kbd
          key={i}
          className={cn(
            "font-mono bg-panel border border-border rounded-[3px] inline-flex items-center justify-center leading-none",
            sizeClasses[size]
          )}
        >
          {token}
        </kbd>
      ))}
    </span>
  );
};
