import React from "react";
import { cn } from "@/core/lib/utils";
import { RegexHighlightOverlay, REGEX_HIGHLIGHT_SELECTION_CSS } from "./RegexHighlightOverlay";

interface RegexHighlightInputProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

export function RegexHighlightInput({ value, onChange, className, ...props }: RegexHighlightInputProps) {
  return (
    <div className={cn("relative flex-1", className)}>
      <style>{REGEX_HIGHLIGHT_SELECTION_CSS}</style>
      <RegexHighlightOverlay value={value} className="px-2 py-1 text-sm" />
      <textarea
        {...props}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="regex-hl-input block w-full px-2 py-1 border rounded bg-bg text-sm resize-none focus-visible:outline-none"
        style={{
          fieldSizing: "content",
          color: value ? "transparent" : undefined,
          caretColor: "var(--fg-primary)",
        } as React.CSSProperties}
      />
    </div>
  );
}
