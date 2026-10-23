import type { AppState, PanelElement } from "../shared/types";

type DirectoryState = AppState["directories"][string];

/** True when a saved window state has everything a window needs to render. */
export function isUsableState(value: unknown): value is AppState {
  const state = value as Partial<AppState> | null;
  return (
    !!state &&
    typeof state === "object" &&
    Array.isArray(state.sidebars?.left?.tabs) &&
    Array.isArray(state.sidebars?.right?.tabs) &&
    !!state.unsaved?.layout &&
    !!state.directories &&
    typeof state.directories === "object"
  );
}

const hasLayout = (entry: unknown): entry is DirectoryState =>
  !!entry && typeof entry === "object" && !!(entry as DirectoryState).layout;

/**
 * Rebuild a broken saved window state on top of a fresh default (#608).
 * Keeps the project the window was on and every project layout that is still
 * valid, so the window reopens on the same project instead of staying blank.
 */
export function repairState(broken: unknown, defaults: AppState, defaultLayout: () => PanelElement): AppState {
  const saved = (broken && typeof broken === "object" ? broken : {}) as Partial<AppState>;
  const directories: AppState["directories"] = { ...defaults.directories };
  for (const [directory, entry] of Object.entries(saved.directories ?? {})) {
    if (hasLayout(entry)) directories[directory] = entry;
  }

  const activeDirectory = typeof saved.activeDirectory === "string" && saved.activeDirectory ? saved.activeDirectory : defaults.activeDirectory;
  if (activeDirectory && !directories[activeDirectory]) {
    directories[activeDirectory] = { layout: defaultLayout() };
  }

  return { ...defaults, activeDirectory, directories };
}
