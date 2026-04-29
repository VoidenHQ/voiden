import { create } from 'zustand';

export interface SearchCallbacks {
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  getStatus: () => string;
}

interface SearchStore {
    term: string
    matchCase: boolean
    matchWholeWord: boolean
    useRegex: boolean
    replaceTerm: string
    showReplace: boolean
    useMultiline: boolean
    isUnifiedSearchActive: boolean
    isOpen: boolean
    status: string
    statusTick: number
    callbacks: SearchCallbacks | null
    openPanelTick: number
    currentLinkedPmNodePos: number | null
    currentLinkedBlockUid: string | null
    currentLinkedLocalIndex: number
    setTerm: (t: string) => void
    setReplaceTerm: (r: string) => void
    setMatchCase: (c: boolean) => void
    setMatchWholeWord: (w: boolean) => void
    setUseRegex: (r: boolean) => void
    setShowReplace: (s: boolean) => void
    setUseMultiline: (m: boolean) => void
    setUnifiedSearchActive: (active: boolean) => void
    setStatus: (s: string) => void
    bumpStatusTick: () => void
    registerSearchCallbacks: (cb: SearchCallbacks) => void
    unregisterSearchCallbacks: () => void
    requestOpenSearchPanel: () => void
    setIsOpen: (open: boolean) => void
    setCurrentLinkedPmNodePos: (pos: number | null) => void
    setCurrentLinkedBlockUid: (uid: string | null) => void
    setCurrentLinkedLocalIndex: (i: number) => void
}

export const useSearchStore = create<SearchStore>(set => ({
    term: '',
    matchCase: false,
    matchWholeWord: false,
    useRegex: false,
    replaceTerm: '',
    showReplace: false,
    useMultiline: false,
    isUnifiedSearchActive: false,
    isOpen: false,
    status: '',
    statusTick: 0,
    callbacks: null,
    openPanelTick: 0,
    currentLinkedPmNodePos: null,
    currentLinkedBlockUid: null,
    currentLinkedLocalIndex: 0,
    setTerm: term => set({ term }),
    setReplaceTerm: replaceTerm => set({ replaceTerm }),
    setMatchCase: matchCase => set({ matchCase }),
    setMatchWholeWord: matchWholeWord => set({ matchWholeWord }),
    setUseRegex: useRegex => set({ useRegex }),
    setShowReplace: showReplace => set({ showReplace }),
    setUseMultiline: useMultiline => set({ useMultiline }),
    setUnifiedSearchActive: isUnifiedSearchActive => set({ isUnifiedSearchActive }),
    setStatus: status => set({ status }),
    bumpStatusTick: () => set(s => ({ statusTick: s.statusTick + 1 })),
    registerSearchCallbacks: callbacks => set({ callbacks }),
    unregisterSearchCallbacks: () => set({ callbacks: null, status: '' }),
    requestOpenSearchPanel: () => set(s => ({ openPanelTick: s.openPanelTick + 1, isOpen: true })),
    setIsOpen: isOpen => set({ isOpen }),
    setCurrentLinkedPmNodePos: currentLinkedPmNodePos => set({ currentLinkedPmNodePos }),
    setCurrentLinkedBlockUid: currentLinkedBlockUid => set({ currentLinkedBlockUid }),
    setCurrentLinkedLocalIndex: currentLinkedLocalIndex => set({ currentLinkedLocalIndex }),
}))
