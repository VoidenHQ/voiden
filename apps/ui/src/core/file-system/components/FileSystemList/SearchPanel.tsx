import { Dispatch, SetStateAction } from "react";
import { Tip } from "@/core/components/ui/Tip";
import { SearchPanelView } from "@/core/editors/code/lib/components/SearchPanelView";
import { ComboboxField } from "./ComboboxField";
import { FullTextSearch } from "./useFullTextSearch";

const FILE_MASK_PRESETS = ["*.void", "*.yaml", "*.json", "*.sh"] as const;

type BoolSetter = Dispatch<SetStateAction<boolean>>;

interface HiddenToggleProps {
  checked: boolean;
  setChecked: BoolSetter;
}

function HiddenToggle({ checked, setChecked }: HiddenToggleProps) {
  return (
    <Tip label="Include hidden files (⌥.)" side="bottom">
      <label tabIndex={-1} className="flex items-center gap-1.5 cursor-pointer select-none rounded px-1 -mx-1 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-accent">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          onKeyDown={(e) => { if (e.key === "Enter") setChecked((v) => !v); }}
          className="w-3.5 h-3.5 shrink-0 accent-[color:var(--color-accent)] focus:outline-none"
        />
        <span className="text-[13px] text-text">Include hidden files</span>
      </label>
    </Tip>
  );
}

interface SearchPanelProps {
  search: FullTextSearch;
  onClose: () => void;
}

export function SearchPanel({ search, onClose }: SearchPanelProps) {
  const {
    rawQuery, setRawQuery,
    matchCase, setMatchCase,
    matchWholeWord, setMatchWholeWord,
    useRegex, setUseRegex,
    useMultiline, setUseMultiline,
    fileMaskEnabled, setFileMaskEnabled,
    fileMask, setFileMask,
    dirMaskEnabled, setDirMaskEnabled,
    dirMask, setDirMask,
    includeHidden, setIncludeHidden,
    dirSuggestions,
    findInputRef,
    dirMaskUserEditedRef,
    rawReplaceQuery, setRawReplaceQuery,
    showReplace, setShowReplace,
    isReplacing, isSearching, searchResults,
    replaceAll,
  } = search;

  return (
    <>
      <SearchPanelView
        findValue={rawQuery}
        replaceValue={rawReplaceQuery}
        matchCase={matchCase}
        matchWholeWord={matchWholeWord}
        useRegex={useRegex}
        multiline={useMultiline}
        showReplace={showReplace}
        hideNav
        findInputRef={findInputRef}
        replaceDisabled={searchResults.length === 0 || isReplacing || isSearching}
        onFindChange={setRawQuery}
        onReplaceChange={setRawReplaceQuery}
        onToggleMatchCase={() => setMatchCase((c) => !c)}
        onToggleMatchWholeWord={() => setMatchWholeWord((w) => !w)}
        onToggleRegex={() => setUseRegex((r) => !r)}
        onToggleMultiline={() => setUseMultiline((m) => !m)}
        onToggleReplaceSection={() => setShowReplace((v) => !v)}
        onReplaceAll={replaceAll}
        onClose={onClose}
      />
      <div className="mt-1.5 flex flex-col gap-1">
        <ComboboxField
          id="file-mask"
          tip="Filter by file pattern (⌥F)"
          label="Files"
          enabled={fileMaskEnabled}
          setEnabled={setFileMaskEnabled}
          value={fileMask}
          onChange={setFileMask}
          placeholder="*.void"
          suggestions={FILE_MASK_PRESETS}
          showChevron
        />
        <ComboboxField
          id="dir-suggestion"
          tip="Filter by directory (⌥D)"
          label="Dir"
          enabled={dirMaskEnabled}
          setEnabled={setDirMaskEnabled}
          value={dirMask}
          onChange={(v) => { dirMaskUserEditedRef.current = true; setDirMask(v); }}
          placeholder="relative/path"
          suggestions={dirSuggestions}
          openOnFocus
          truncateItems
          appendOnPick="/"
        />
        <HiddenToggle checked={includeHidden} setChecked={setIncludeHidden} />
      </div>
    </>
  );
}
