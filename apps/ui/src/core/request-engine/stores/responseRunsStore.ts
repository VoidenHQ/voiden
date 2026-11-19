import { create } from "zustand";
import { createStore, del, get as idbGet, set as idbSet } from "idb-keyval";
import { snapshotRun, type ResponseRun } from "../utils/responseDiff";

/** How many past responses each request section keeps for Compare. */
export const MAX_RUNS_PER_SECTION = 10;

/** Larger bodies stay in memory for this session but aren't saved to disk. */
const MAX_SAVED_BODY_BYTES = 1024 * 1024;

export type DiffBodyView = "semantic" | "split" | "unified";

/**
 * Which request a run belongs to. Section 0 (everything before the first separator) is
 * "default", so a file with one request keeps one history. Every later section is keyed by
 * its separator's uid, so adding, removing or reordering requests doesn't mix up their runs.
 * `#N` is the fallback for a separator without a uid (and for runs saved before uids were used).
 */
export const DEFAULT_SECTION = "default";
export const fallbackSectionId = (sectionIndex: number) => (sectionIndex <= 0 ? DEFAULT_SECTION : `#${sectionIndex}`);

/** The section id of the request at `sectionIndex` in an editor doc (ProseMirror node). */
export function sectionIdAt(doc: { forEach: (fn: (child: any) => void) => void } | null | undefined, sectionIndex: number): string {
  if (!doc || sectionIndex <= 0) return DEFAULT_SECTION;
  let sep = 0;
  let uid: string | null = null;
  doc.forEach((child: any) => {
    if (child?.type?.name === "request-separator" && ++sep === sectionIndex) uid = child.attrs?.uid || null;
  });
  return uid ?? fallbackSectionId(sectionIndex);
}

const indexKey = (tabId: string, sectionIndex: number) => `${tabId}:${sectionIndex}`;

/** Store key for the runs of the request shown at `sectionIndex` in a tab's response panel. */
export const runKey = (tabId: string, sectionIndex: number, sectionIds = useResponseRunsStore.getState().sectionIds) =>
  `${tabId}:${sectionIds[indexKey(tabId, sectionIndex)] ?? fallbackSectionId(sectionIndex)}`;

/** Same as runKey, subscribed: re-renders when the request at that position changes. */
export const useRunKey = (tabId: string, sectionIndex: number) =>
  useResponseRunsStore((s) => runKey(tabId, sectionIndex, s.sectionIds));

const splitKey = (key: string) => {
  const at = key.lastIndexOf(":");
  return { tabId: key.slice(0, at), sectionId: key.slice(at + 1) };
};

/**
 * Past runs are saved in the app's own IndexedDB, on this device only. That lives in the
 * app's profile folder, never in the project, so nothing here can be committed.
 * One record per .void file path, holding each request's runs (newest first) and the
 * latest full response doc, so the response panel can show it again after a restart.
 * Requests are keyed by section id (see sectionIdAt), with their last known position.
 */
let db: ReturnType<typeof createStore> | null = null;
/** Opened on first use, so importing this store never touches IndexedDB. */
const runsDb = () => (db ??= createStore("voiden-response-runs", "runs"));

interface SavedSection {
  runs: ResponseRun[];
  /** Latest full response doc, restored into the response panel */
  doc?: unknown;
  /** Where this request was in the file when it last ran */
  index?: number;
}
interface SavedFile {
  v: 3;
  /** section id → saved runs */
  sections: Record<string, SavedSection>;
}
/** Version 2 keyed sections by position: { v: 2, sections: { [sectionIndex]: { runs, doc } } } */
interface SavedFileV2 {
  v: 2;
  sections: Record<number, Omit<SavedSection, "index">>;
}
/** Version 1 stored runs only: { [sectionIndex]: runs } */
type LegacySavedFile = Record<number, ResponseRun[]>;

function readSaved(raw: SavedFile | SavedFileV2 | LegacySavedFile | undefined): SavedFile | undefined {
  if (!raw) return undefined;
  if ((raw as SavedFile).v === 3) return raw as SavedFile;
  const byIndex: Record<number, Omit<SavedSection, "index">> = {};
  if ((raw as SavedFileV2).v === 2) Object.assign(byIndex, (raw as SavedFileV2).sections);
  else {
    for (const [k, runs] of Object.entries(raw as LegacySavedFile)) if (Array.isArray(runs)) byIndex[Number(k)] = { runs };
  }
  // Old saves only knew positions; their runs move to the request's uid on its next run.
  const sections: Record<string, SavedSection> = {};
  for (const [k, section] of Object.entries(byIndex)) sections[fallbackSectionId(Number(k))] = { ...section, index: Number(k) };
  return { v: 3, sections };
}

interface ResponseRunsState {
  /** runKey → runs, newest first */
  runs: Record<string, ResponseRun[]>;
  /** Next run number per runKey */
  nextId: Record<string, number>;
  /** runKey → Compare mode open */
  compareOpen: Record<string, boolean>;
  /** tabId → .void file path, so runs can be saved per file */
  tabSources: Record<string, string>;
  /** runKey → latest live response doc (saved with the runs) */
  lastDocs: Record<string, unknown>;
  /** "tabId:sectionIndex" → section id of the request last run at that position */
  sectionIds: Record<string, string>;

  /** Shared view preferences for every Compare view */
  bodyView: DiffBodyView;
  ignoreVolatile: boolean;
  showUnchanged: boolean;

  /** Called when a request is sent: which request (section id) sits at that position now */
  noteSection: (tabId: string, sectionIndex: number, sectionId: string) => void;
  record: (tabId: string, sectionIndex: number, doc: unknown, source?: ResponseRun["source"]) => void;
  /** Link a tab to its file, loading the runs saved for that file */
  linkTab: (tabId: string, filePath: string) => Promise<void>;
  /** Forget every run of one request (by runKey), in memory and on disk */
  forgetRuns: (key: string) => void;
  toggleCompare: (key: string, open?: boolean) => void;
  setBodyView: (view: DiffBodyView) => void;
  setIgnoreVolatile: (on: boolean) => void;
  setShowUnchanged: (on: boolean) => void;
}

/** IndexedDB rejects the whole write on one value it can't clone, so drop such docs up front. */
function cloneable(doc: unknown): unknown {
  if (doc === undefined) return undefined;
  try {
    structuredClone(doc);
    return doc;
  } catch {
    return undefined;
  }
}

function sectionsOf(state: ResponseRunsState, tabId: string): SavedFile {
  const positions: Record<string, number> = {};
  for (const [k, id] of Object.entries(state.sectionIds)) {
    if (k.startsWith(`${tabId}:`)) positions[id] = Number(k.slice(tabId.length + 1));
  }
  const sections: Record<string, SavedSection> = {};
  for (const [key, runs] of Object.entries(state.runs)) {
    if (!key.startsWith(`${tabId}:`)) continue;
    const saved = runs.filter((r) => r.source === "live" && r.bytes <= MAX_SAVED_BODY_BYTES);
    if (!saved.length) continue;
    const id = key.slice(tabId.length + 1);
    const section: SavedSection = { runs: saved };
    // The doc is only worth keeping when it is the response of the newest saved run.
    const doc = runs[0] === saved[0] ? cloneable(state.lastDocs[key]) : undefined;
    if (doc !== undefined) section.doc = doc;
    const index = positions[id] ?? (id === DEFAULT_SECTION ? 0 : /^#\d+$/.test(id) ? Number(id.slice(1)) : undefined);
    if (index !== undefined) section.index = index;
    sections[id] = section;
  }
  return { v: 3, sections };
}

/** Writes are coalesced per file so a burst of responses (run all) is one write. */
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSave(tabId: string) {
  const filePath = useResponseRunsStore.getState().tabSources[tabId];
  if (!filePath) return; // saved once the tab is linked
  clearTimeout(pendingWrites.get(filePath));
  pendingWrites.set(
    filePath,
    setTimeout(() => {
      pendingWrites.delete(filePath);
      const data = sectionsOf(useResponseRunsStore.getState(), tabId);
      const write = Object.keys(data.sections).length ? idbSet(filePath, data, runsDb()) : del(filePath, runsDb());
      write.catch((e) => console.error("[response runs] Could not save past responses:", e));
    }, 400),
  );
}

/**
 * Put each request's last response back in the response panel after a restart, when the
 * panel has nothing for it yet. Imported lazily: responseStore imports this store.
 */
async function restoreResponses(tabId: string, saved: SavedFile) {
  const { useResponseStore } = await import("./responseStore");
  const store = useResponseStore.getState();
  const ids = useResponseRunsStore.getState().sectionIds;
  for (const [id, { runs, doc, index }] of Object.entries(saved.sections)) {
    if (!doc || typeof doc !== "object" || index === undefined) continue;
    // Another request has taken this position since; its response isn't this one.
    if ((ids[indexKey(tabId, index)] ?? fallbackSectionId(index)) !== id) continue;
    const existing = store.responses[tabId]?.[index];
    if (existing?.responseDoc || existing?.error) continue;
    const d = doc as { attrs?: Record<string, unknown> };
    store.hydrateResponse(tabId, { ...d, attrs: { ...(d.attrs ?? {}), sectionIndex: index } }, null, runs[0]?.timestamp);
  }
}

export const useResponseRunsStore = create<ResponseRunsState>((set, get) => ({
  runs: {},
  nextId: {},
  compareOpen: {},
  tabSources: {},
  lastDocs: {},
  sectionIds: {},
  bodyView: "semantic",
  ignoreVolatile: true,
  showUnchanged: false,

  noteSection: (tabId, sectionIndex, sectionId) => {
    const ik = indexKey(tabId, sectionIndex);
    const state = get();
    if (state.sectionIds[ik] === sectionId) return;
    const key = `${tabId}:${sectionId}`;
    // Runs kept under the position-only id (older saves, or before a uid was assigned)
    // belong to the request now known to be there.
    const legacyKey = `${tabId}:${fallbackSectionId(sectionIndex)}`;
    const adopt = legacyKey !== key && !state.runs[key]?.length && state.runs[legacyKey]?.length;
    set((s) => {
      const next: Partial<ResponseRunsState> = { sectionIds: { ...s.sectionIds, [ik]: sectionId } };
      if (adopt) {
        const runs = { ...s.runs, [key]: s.runs[legacyKey] };
        const nextId = { ...s.nextId, [key]: s.nextId[legacyKey] ?? 1 };
        const lastDocs = { ...s.lastDocs, [key]: s.lastDocs[legacyKey] };
        delete runs[legacyKey];
        delete nextId[legacyKey];
        delete lastDocs[legacyKey];
        Object.assign(next, { runs, nextId, lastDocs });
      }
      return next;
    });
    if (adopt) scheduleSave(tabId);
  },

  record: (tabId, sectionIndex, doc, source = "live") => {
    const state = get();
    const key = runKey(tabId, sectionIndex, state.sectionIds);
    // The response saved in the file is only a useful baseline before any live run.
    if (source === "file" && state.runs[key]?.length) return;
    const id = state.nextId[key] ?? 1;
    const run = snapshotRun(doc, id, source);
    if (!run) return;
    set((s) => ({
      runs: { ...s.runs, [key]: [run, ...(s.runs[key] ?? [])].slice(0, MAX_RUNS_PER_SECTION) },
      nextId: { ...s.nextId, [key]: id + 1 },
      ...(source === "live" ? { lastDocs: { ...s.lastDocs, [key]: doc } } : {}),
    }));
    if (source === "live") scheduleSave(tabId);
  },

  linkTab: async (tabId, filePath) => {
    if (get().tabSources[tabId] === filePath) return;
    set((s) => ({ tabSources: { ...s.tabSources, [tabId]: filePath } }));

    let saved: SavedFile | undefined;
    try {
      saved = readSaved(await idbGet<SavedFile | SavedFileV2 | LegacySavedFile>(filePath, runsDb()));
    } catch (e) {
      console.error("[response runs] Could not read past responses:", e);
    }
    const hadUnsaved = Object.keys(sectionsOf(get(), tabId).sections).length > 0;

    if (saved) {
      const loadedFile = saved;
      set((s) => {
        const runs = { ...s.runs };
        const nextId = { ...s.nextId };
        const lastDocs = { ...s.lastDocs };
        const sectionIds = { ...s.sectionIds };
        // Newest first, so when two saved requests claim one position the latest run wins.
        const newest = (sec: SavedSection) => sec.runs[0]?.timestamp ?? 0;
        const entries = Object.entries(loadedFile.sections).sort(([, x], [, y]) => newest(y) - newest(x));
        for (const [id, { index }] of entries) {
          if (index === undefined || id === fallbackSectionId(index)) continue;
          sectionIds[indexKey(tabId, index)] ??= id;
        }
        for (const [section, { runs: savedRuns, doc }] of entries) {
          const key = `${tabId}:${section}`;
          const known = new Set((runs[key] ?? []).map((r) => r.timestamp));
          const loaded = savedRuns.filter((r) => !known.has(r.timestamp));
          // The file's saved response only matters when there's nothing older to compare with.
          const current = (runs[key] ?? []).filter((r) => r.source === "live" || !loaded.length);
          // Runs made before loading finished get numbers after the saved ones.
          let next = Math.max(0, ...loaded.map((r) => r.id)) + 1;
          const renumbered = current.map((r) => ({ ...r, id: next++ }));
          runs[key] = [...renumbered, ...loaded]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, MAX_RUNS_PER_SECTION);
          nextId[key] = next;
          if (doc !== undefined && lastDocs[key] === undefined) lastDocs[key] = doc;
        }
        return { runs, nextId, lastDocs, sectionIds };
      });
      await restoreResponses(tabId, loadedFile);
    }
    if (saved || hadUnsaved) scheduleSave(tabId);
  },

  forgetRuns: (key) => {
    const { tabId } = splitKey(key);
    set((s) => {
      const runs = { ...s.runs };
      const lastDocs = { ...s.lastDocs };
      delete runs[key];
      delete lastDocs[key];
      return { runs, lastDocs, compareOpen: { ...s.compareOpen, [key]: false } };
    });
    scheduleSave(tabId);
  },

  toggleCompare: (key, open) =>
    set((s) => ({ compareOpen: { ...s.compareOpen, [key]: open ?? !s.compareOpen[key] } })),

  setBodyView: (bodyView) => set({ bodyView }),
  setIgnoreVolatile: (ignoreVolatile) => set({ ignoreVolatile }),
  setShowUnchanged: (showUnchanged) => set({ showUnchanged }),
}));
