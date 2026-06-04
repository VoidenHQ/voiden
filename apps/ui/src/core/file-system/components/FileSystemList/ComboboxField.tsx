import { Dispatch, KeyboardEvent, SetStateAction, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Tip } from "@/core/components/ui/Tip";
import { cn } from "@/core/lib/utils";

type BoolSetter = Dispatch<SetStateAction<boolean>>;

interface ComboboxFieldProps {
  id: string;
  tip: string;
  label: string;
  enabled: boolean;
  setEnabled: BoolSetter;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  suggestions: readonly string[];
  showChevron?: boolean;
  openOnFocus?: boolean;
  truncateItems?: boolean;
  appendOnPick?: string;
}

export function ComboboxField({
  id, tip, label, enabled, setEnabled, value, onChange, placeholder,
  suggestions, showChevron, openOnFocus, truncateItems, appendOnPick,
}: ComboboxFieldProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!open) setActiveIndex(-1); }, [open]);
  useEffect(() => { setActiveIndex(-1); }, [suggestions]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (
        !inputRef.current?.contains(t) &&
        !buttonRef.current?.contains(t) &&
        !listRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const pick = (item: string) => {
    onChange(item + (appendOnPick ?? ""));
    if (!appendOnPick) setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
      return;
    }
    if (e.key === "Enter" && open && activeIndex >= 0) {
      e.preventDefault();
      pick(suggestions[activeIndex]);
    }
  };

  const inputClass = cn(
    "text-[13px] px-2 py-0.5 bg-active border border-border w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:border-accent",
    !enabled && "opacity-40 cursor-not-allowed",
    showChevron ? "rounded-l" : "rounded",
  );

  return (
    <div className="flex items-center gap-1.5">
      <Tip label={tip} side="bottom">
        <label tabIndex={-1} className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none rounded px-1 -mx-1 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-accent">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            onKeyDown={(e) => { if (e.key === "Enter") setEnabled((v) => !v); }}
            className="w-3.5 h-3.5 shrink-0 accent-[color:var(--color-accent)] focus:outline-none"
          />
          <span className="text-[13px] text-text">{label}</span>
        </label>
      </Tip>
      <div className={cn("relative flex-1 min-w-0", showChevron && "flex")}>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => { if (openOnFocus) setOpen(true); }}
          onBlur={(e) => {
            if (!listRef.current?.contains(e.relatedTarget as Node)) {
              setOpen(false);
            }
          }}
          onKeyDown={onKeyDown}
          disabled={!enabled}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-activedescendant={activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
          className={inputClass}
        />
        {showChevron && (
          <button
            ref={buttonRef}
            type="button"
            disabled={!enabled}
            tabIndex={-1}
            onClick={() => {
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
            className={cn(
              "shrink-0 px-1 bg-active border border-l-0 border-border rounded-r text-text hover:bg-hover transition-colors",
              !enabled && "opacity-40 cursor-not-allowed",
            )}
            aria-label={`${label} presets`}
            aria-expanded={open}
            aria-haspopup="listbox"
          >
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        )}
        {enabled && open && suggestions.length > 0 && (
          <div
            ref={listRef}
            role="listbox"
            className={cn(
              "absolute z-50 top-full mt-0.5 bg-panel border border-border rounded shadow-lg overflow-hidden",
              showChevron ? "right-0 min-w-[6rem]" : "left-0 right-0",
            )}
          >
            {suggestions.map((item, idx) => (
              <button
                key={item}
                id={`${id}-${idx}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={idx === activeIndex}
                onPointerDown={(e) => { e.preventDefault(); pick(item); }}
                className={cn(
                  "w-full text-left text-[13px] px-2 py-1 text-text",
                  idx === activeIndex ? "bg-active" : "hover:bg-active",
                  truncateItems && "truncate",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
