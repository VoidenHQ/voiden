import React, { useRef, useEffect } from "react";
import { useSearchStore } from "@/core/stores/searchParamsStore";
import { SearchPanelView } from "@/core/editors/code/lib/components/SearchPanelView";

export function PersistentSearchPanel() {
  const isOpen = useSearchStore((s) => s.isOpen);
  const callbacks = useSearchStore((s) => s.callbacks);
  const term = useSearchStore((s) => s.term);
  const setTerm = useSearchStore((s) => s.setTerm);
  const replaceTerm = useSearchStore((s) => s.replaceTerm);
  const setReplaceTerm = useSearchStore((s) => s.setReplaceTerm);
  const matchCase = useSearchStore((s) => s.matchCase);
  const setMatchCase = useSearchStore((s) => s.setMatchCase);
  const matchWholeWord = useSearchStore((s) => s.matchWholeWord);
  const setMatchWholeWord = useSearchStore((s) => s.setMatchWholeWord);
  const useRegex = useSearchStore((s) => s.useRegex);
  const setUseRegex = useSearchStore((s) => s.setUseRegex);
  const useMultiline = useSearchStore((s) => s.useMultiline);
  const setUseMultiline = useSearchStore((s) => s.setUseMultiline);
  const showReplace = useSearchStore((s) => s.showReplace);
  const setShowReplace = useSearchStore((s) => s.setShowReplace);
  // statusTick causes a re-render when CM pushes an update so getStatus() reads fresh state
  useSearchStore((s) => s.statusTick);
  const findInputRef = useRef<HTMLTextAreaElement>(null);

  const openPanelTick = useSearchStore((s) => s.openPanelTick);

  // Focus the find input whenever the panel opens or is re-triggered while already open.
  useEffect(() => {
    if (isOpen && findInputRef.current) {
      findInputRef.current.focus();
    }
  }, [isOpen, openPanelTick]);

  if (!isOpen) return null;

  const noQuery = !term;
  const status = callbacks?.getStatus() ?? "";

  return (
    <SearchPanelView
      findValue={term}
      replaceValue={replaceTerm}
      matchCase={matchCase}
      matchWholeWord={matchWholeWord}
      useRegex={useRegex}
      multiline={useMultiline}
      showReplace={showReplace}
      status={status}
      navDisabled={noQuery || !callbacks}
      replaceDisabled={noQuery || !callbacks}
      findInputRef={findInputRef}
      onFindChange={setTerm}
      onReplaceChange={setReplaceTerm}
      onToggleMatchCase={() => setMatchCase(!matchCase)}
      onToggleMatchWholeWord={() => setMatchWholeWord(!matchWholeWord)}
      onToggleRegex={() => setUseRegex(!useRegex)}
      onToggleMultiline={() => setUseMultiline(!useMultiline)}
      onFindNext={callbacks?.onFindNext}
      onFindPrevious={callbacks?.onFindPrevious}
      onClose={callbacks?.onClose ?? (() => useSearchStore.getState().setIsOpen(false))}
      onReplace={callbacks?.onReplace}
      onReplaceAll={callbacks?.onReplaceAll}
      onToggleReplaceSection={() => setShowReplace(!showReplace)}
    />
  );
}
