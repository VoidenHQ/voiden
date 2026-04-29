import React from "react";
import { useHotkeys } from "react-hotkeys-hook";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CaseSensitive,
  WholeWord,
  Regex,
  WrapText,
  X,
  Replace,
  ReplaceAll,
} from "lucide-react";
import { Tip } from "@/core/components/ui/Tip";
import { RegexHighlightOverlay, REGEX_HIGHLIGHT_SELECTION_CSS } from "@/core/file-system/components/RegexHighlightOverlay";
import { cn } from "@/core/lib/utils";

export interface SearchPanelViewProps {
  findValue: string;
  replaceValue: string;
  matchCase: boolean;
  matchWholeWord: boolean;
  useRegex: boolean;
  multiline: boolean;
  showReplace: boolean;
  status?: string;
  navDisabled?: boolean;
  replaceDisabled?: boolean;
  hideNav?: boolean;
  autoFocus?: boolean;
  className?: string;
  findInputRef?: React.Ref<HTMLTextAreaElement>;
  onFindChange: (value: string) => void;
  onReplaceChange: (value: string) => void;
  onToggleMatchCase: () => void;
  onToggleMatchWholeWord: () => void;
  onToggleRegex: () => void;
  onToggleMultiline: () => void;
  onFindNext?: () => void;
  onFindPrevious?: () => void;
  onClose: () => void;
  onReplace?: () => void;
  onReplaceAll?: () => void;
  onToggleReplaceSection?: () => void;
}

const toggleBtn = (active: boolean) =>
  cn(
    "p-1 rounded w-6 h-6 flex items-center justify-center transition-colors",
    active
      ? "bg-accent/20 text-accent"
      : "text-text hover:bg-active active:scale-[0.96]",
  );

const iconBtn = (disabled: boolean) =>
  cn(
    "p-1 rounded w-6 h-6 flex items-center justify-center transition-colors",
    disabled
      ? "text-text opacity-25 cursor-not-allowed"
      : "text-text hover:bg-active active:scale-[0.96]",
  );

const inputClass =
  "text-[13px] leading-[22px] px-2 py-0 bg-active border border-panel-border rounded resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:border-accent";

export function SearchPanelView({
  findValue,
  replaceValue,
  matchCase,
  matchWholeWord,
  useRegex,
  multiline,
  showReplace,
  status,
  navDisabled = false,
  replaceDisabled = false,
  hideNav = false,
  autoFocus,
  className,
  findInputRef,
  onFindChange,
  onReplaceChange,
  onToggleMatchCase,
  onToggleMatchWholeWord,
  onToggleRegex,
  onToggleMultiline,
  onFindNext,
  onFindPrevious,
  onClose,
  onReplace,
  onReplaceAll,
  onToggleReplaceSection,
}: SearchPanelViewProps) {
  const isMac = /Mac/i.test(navigator.userAgent);

  const containerRef = useHotkeys<HTMLDivElement>(
    ["mod+h", "alt+c", "alt+w", "alt+r", "alt+m", "escape"],
    (_e, handler) => {
      switch (handler.hotkey) {
        case "mod+h": onToggleReplaceSection?.(); break;
        case "alt+c": onToggleMatchCase(); break;
        case "alt+w": onToggleMatchWholeWord(); break;
        case "alt+r": onToggleRegex(); break;
        case "alt+m": onToggleMultiline(); break;
        case "escape": onClose(); break;
      }
    },
    { enableOnFormTags: ["TEXTAREA"], preventDefault: true },
    [onToggleReplaceSection, onToggleMatchCase, onToggleMatchWholeWord, onToggleRegex, onToggleMultiline, onClose],
  );

  const handleFindKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      if (multiline && !e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      if (e.shiftKey) onFindPrevious?.(); else onFindNext?.();
    }
  };

  const handleReplaceKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      if (multiline && !e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && !multiline) onReplaceAll?.();
      else if (multiline && e.shiftKey) onReplaceAll?.();
      else onReplace?.();
    }
  };

  return (
    <Tooltip.Provider delayDuration={300}>
      <div ref={containerRef} className={cn("flex flex-col w-full border border-border rounded px-1", className)}>
        {/* Find row */}
        <div className="flex items-start gap-1 w-full">
          {onToggleReplaceSection && (
            <Tip label={`Toggle Replace (${isMac ? "⌘H" : "Ctrl+H"})`} side="bottom">
              <button onClick={onToggleReplaceSection} className={cn(toggleBtn(showReplace), "mt-0.5")}>
                {showReplace ? <ChevronDown size={16} strokeWidth={2} /> : <ChevronRight size={16} strokeWidth={2} />}
              </button>
            </Tip>
          )}

          <div className="relative flex-1 min-w-[120px] max-w-[280px] mt-0.5">
            {useRegex && <style>{REGEX_HIGHLIGHT_SELECTION_CSS}</style>}
            {useRegex && <RegexHighlightOverlay value={findValue} className="px-2 py-0 text-[13px] leading-[22px] border border-transparent" />}
            <textarea
              ref={findInputRef}
              rows={1}
              placeholder="Find"
              value={findValue}
              onChange={(e) => onFindChange(e.target.value)}
              onKeyDown={handleFindKeyDown}
              autoFocus={autoFocus}
              {...({ "main-field": "true" } as Record<string, string>)}
              className={cn(inputClass, "block w-full overflow-y-auto !bg-transparent", useRegex && "regex-hl-input")}
              style={{
                fieldSizing: "content",
                maxHeight: "calc(4 * 1.5em + 0.5rem)",
                ...(useRegex && findValue ? { color: "transparent", caretColor: "var(--fg-primary)" } : null),
              } as React.CSSProperties}
            />
          </div>

          <div className="flex items-center gap-0.5 mt-0.5">
            <Tip label={`Match Case (${isMac ? "⌥C" : "Alt+C"})`} side="bottom">
              <button onClick={onToggleMatchCase} className={toggleBtn(matchCase)}>
                <CaseSensitive size={16} strokeWidth={2} />
              </button>
            </Tip>
            <Tip label={`Whole Word (${isMac ? "⌥W" : "Alt+W"})`} side="bottom">
              <button onClick={onToggleMatchWholeWord} className={toggleBtn(matchWholeWord)}>
                <WholeWord size={16} strokeWidth={2} />
              </button>
            </Tip>
            <Tip label={`Use Regular Expression (${isMac ? "⌥R" : "Alt+R"})`} side="bottom">
              <button onClick={onToggleRegex} className={toggleBtn(useRegex)}>
                <Regex size={16} strokeWidth={2} />
              </button>
            </Tip>
            <Tip label={`Match across lines (${isMac ? "⌥M" : "Alt+M"})`} side="bottom">
              <button onClick={onToggleMultiline} className={toggleBtn(multiline)}>
                <WrapText size={16} strokeWidth={2} />
              </button>
            </Tip>
          </div>

          {!hideNav && (
            <div className="flex items-center gap-0.5 mt-0.5">
              <Tip label="Previous" side="bottom">
                <button onClick={onFindPrevious} disabled={navDisabled} className={iconBtn(navDisabled)}>
                  <ChevronUp size={16} strokeWidth={2} />
                </button>
              </Tip>
              <Tip label="Next" side="bottom">
                <button onClick={onFindNext} disabled={navDisabled} className={iconBtn(navDisabled)}>
                  <ChevronDown size={16} strokeWidth={2} />
                </button>
              </Tip>
            </div>
          )}

          {status && (
            <span className="text-[13px] text-comment whitespace-nowrap shrink-0 mt-1">{status}</span>
          )}

          <Tip label="Close (Esc)" side="bottom">
            <button onClick={onClose} className={cn(iconBtn(false), "ml-auto mt-0.5")}>
              <X size={16} strokeWidth={2} />
            </button>
          </Tip>
        </div>

        {/* Replace row */}
        {showReplace && (
          <div className="flex items-start gap-1 w-full pt-0.5 pb-0.5">
            {onToggleReplaceSection && <div aria-hidden className="w-6 shrink-0" />}
            <textarea
              rows={1}
              placeholder="Replace"
              value={replaceValue}
              onChange={(e) => onReplaceChange(e.target.value)}
              onKeyDown={handleReplaceKeyDown}
              autoComplete="off"
              className={cn(inputClass, "flex-1 min-w-[120px] max-w-[280px] overflow-y-auto !bg-transparent")}
              style={{ fieldSizing: "content", maxHeight: "calc(4 * 1.5em + 0.5rem)" } as React.CSSProperties}
            />
            <div className="flex items-center gap-0.5">
              <Tip label="Replace" side="bottom">
                <button onClick={onReplace} disabled={replaceDisabled} className={iconBtn(replaceDisabled)}>
                  <Replace size={16} />
                </button>
              </Tip>
              <Tip label="Replace All" side="bottom">
                <button onClick={onReplaceAll} disabled={replaceDisabled} className={iconBtn(replaceDisabled)}>
                  <ReplaceAll size={16} />
                </button>
              </Tip>
            </div>
          </div>
        )}
      </div>
    </Tooltip.Provider>
  );
}
