import React, { useRef, useEffect } from "react";
import { useSearchStore } from "@/core/stores/searchParamsStore";
import { useShallow } from "zustand/react/shallow";
import { SearchPanelView } from "@/core/editors/code/lib/components/SearchPanelView";

export function PersistentSearchPanel() {
  const { isOpen, callbacks, term, replaceTerm, matchCase, matchWholeWord, useRegex, useMultiline, showReplace, openPanelTick } = useSearchStore(useShallow((s) => ({
    isOpen: s.isOpen,
    callbacks: s.callbacks,
    term: s.term,
    replaceTerm: s.replaceTerm,
    matchCase: s.matchCase,
    matchWholeWord: s.matchWholeWord,
    useRegex: s.useRegex,
    useMultiline: s.useMultiline,
    showReplace: s.showReplace,
    // statusTick causes a re-render when CM pushes an update so getStatus() reads fresh state
    _statusTick: s.statusTick,
    openPanelTick: s.openPanelTick,
  })));
  const setTerm = useSearchStore((s) => s.setTerm);
  const setReplaceTerm = useSearchStore((s) => s.setReplaceTerm);
  const setMatchCase = useSearchStore((s) => s.setMatchCase);
  const setMatchWholeWord = useSearchStore((s) => s.setMatchWholeWord);
  const setUseRegex = useSearchStore((s) => s.setUseRegex);
  const setUseMultiline = useSearchStore((s) => s.setUseMultiline);
  const setShowReplace = useSearchStore((s) => s.setShowReplace);
  const findInputRef = useRef<HTMLTextAreaElement>(null);

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
