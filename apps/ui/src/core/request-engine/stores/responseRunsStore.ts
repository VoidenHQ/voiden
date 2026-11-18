import { create } from "zustand";
import { createStore, del, get as idbGet, set as idbSet } from "idb-keyval";
import { snapshotRun, type ResponseRun } from "../utils/responseDiff";

/** How many past responses each request section keeps for Compare. */
export const MAX_RUNS_PER_SECTION = 10;

/** Larger bodies stay in memory for this session but aren't saved to disk. */
const MAX_SAVED_BODY_BYTES = 1024 * 1024;

export type DiffBodyView = "semantic" | "split" | "unified";

export const runKey = (tabId: string, sectionIndex: number) => `${tabId}:${sectionIndex}`;

/**
 * Past runs are saved in the app's own IndexedDB, on this device only. That lives in the
 * app's profile folder, never in the project, so nothing here can be committed.
 * One record per .void file path, holding each request's runs (newest first) and the
 * latest full response doc, so the response panel can show it again after a restart.
 */
let db: ReturnType<typeof createStore> | null = null;
/** Opened on first use, so importing this store never touches IndexedDB. */
const runsDb = () => (db ??= createStore("voiden-response-runs", "runs"));

interface SavedSection {
  runs: ResponseRun[];
  /** Latest full response doc, restored into the response panel */
  doc?: unknown;
}
interface SavedFile {
  v: 2;
  sections: Record<number, SavedSection>;
}
/** Version 1 stored runs only: { [sectionIndex]: runs } */
type LegacySavedFile = Record<number, ResponseRun[]>;

function readSaved(raw: SavedFile | LegacySavedFile | undefined): SavedFile | undefined {
  if (!raw) return undefined;
  if ((raw as SavedFile).v === 2) return raw as SavedFile;
  const sections: Record<number, SavedSection> = {};
  for (const [k, runs] of Object.entries(raw as LegacySavedFile)) {
    if (Array.isArray(runs)) sections[Number(k)] = { runs };
  }
  return { v: 2, sections };
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

  /** Shared view preferences for every Compare view */
  bodyView: DiffBodyView;
  ignoreVolatile: boolean;
  showUnchanged: boolean;

  record: (tabId: string, sectionIndex: number, doc: unknown, source?: ResponseRun["source"]) => void;
  /** Link a tab to its file, loading the runs saved for that file */
  linkTab: (tabId: string, filePath: string) => Promise<void>;
  /** Forget every run of one request, in memory and on disk */
  forgetRuns: (tabId: string, sectionIndex: number) => void;
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
  const sections: Record<number, SavedSection> = {};
  for (const [key, runs] of Object.entries(state.runs)) {
    if (!key.startsWith(`${tabId}:`)) continue;
    const saved = runs.filter((r) => r.source === "live" && r.bytes <= MAX_SAVED_BODY_BYTES);
    if (!saved.length) continue;
    // The doc is only worth keeping when it is the response of the newest saved run.
    const doc = runs[0] === saved[0] ? cloneable(state.lastDocs[key]) : undefined;
    sections[Number(key.slice(tabId.length + 1))] = doc === undefined ? { runs: saved } : { runs: saved, doc };
  }
  return { v: 2, sections };
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
  for (const [section, { runs, doc }] of Object.entries(saved.sections)) {
    if (!doc || typeof doc !== "object") continue;
    const index = Number(section);
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
  bodyView: "semantic",
  ignoreVolatile: true,
  showUnchanged: false,

  record: (tabId, sectionIndex, doc, source = "live") => {
    const key = runKey(tabId, sectionIndex);
    const state = get();
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
      saved = readSaved(await idbGet<SavedFile | LegacySavedFile>(filePath, runsDb()));
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
        for (const [section, { runs: savedRuns, doc }] of Object.entries(loadedFile.sections)) {
          const key = runKey(tabId, Number(section));
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
        return { runs, nextId, lastDocs };
      });
      await restoreResponses(tabId, loadedFile);
    }
    if (saved || hadUnsaved) scheduleSave(tabId);
  },

  forgetRuns: (tabId, sectionIndex) => {
    const key = runKey(tabId, sectionIndex);
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
