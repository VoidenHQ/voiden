import { describe, expect, it } from "vitest";
import type { AppState, PanelElement } from "../../shared/types";
import { isUsableState, repairState } from "../stateRepair";

const layout = (): PanelElement => ({
  id: "group",
  type: "group",
  children: [{ id: "main", type: "panel", tabs: [], activeTabId: null }],
} as unknown as PanelElement);

const defaults = (): AppState => ({
  id: null,
  activeDirectory: null,
  onboarding: false,
  showOnboarding: true,
  directories: {},
  unsaved: { layout: layout() },
  sidebars: {
    left: { activeTabId: "files", tabs: [{ id: "files", type: "fileExplorer" }] },
    right: { activeTabId: "response", tabs: [{ id: "response", type: "responsePanel" }] },
  },
  extensions: [],
} as unknown as AppState);

// The exact file a window was left with after File > Open Recent (#608).
const brokenFromOpenRecent = {
  directories: {
    "/work/project-a": { tabs: [] },
    "/work/project-b": { tabs: [] },
  },
  activeDirectory: "/work/project-a",
};

describe("isUsableState", () => {
  it("rejects the state Open Recent used to leave behind", () => {
    expect(isUsableState(brokenFromOpenRecent)).toBe(false);
  });

  it("rejects empty and non-object values", () => {
    expect(isUsableState(null)).toBe(false);
    expect(isUsableState({})).toBe(false);
    expect(isUsableState("state")).toBe(false);
  });

  it("accepts a complete state", () => {
    expect(isUsableState(defaults())).toBe(true);
  });

  it("accepts a state saved by older versions, so it is never reset", () => {
    // Shape written since v1.1.0: no `id` or `showOnboarding`, extra fields kept.
    const old = { activeDirectory: "/work/a", onboarding: true, directories: { "/work/a": { layout: layout() } }, unsaved: { layout: layout() }, sidebars: defaults().sidebars, extensions: [], somethingNew: 1 };
    expect(isUsableState(old)).toBe(true);
  });

  it("rejects a state missing one sidebar", () => {
    const state = defaults() as any;
    delete state.sidebars.right;
    expect(isUsableState(state)).toBe(false);
  });
});

describe("repairState", () => {
  it("rebuilds a usable state and keeps the project the window was on", () => {
    const repaired = repairState(brokenFromOpenRecent, defaults(), layout);
    expect(isUsableState(repaired)).toBe(true);
    expect(repaired.activeDirectory).toBe("/work/project-a");
    expect(repaired.directories["/work/project-a"].layout).toBeTruthy();
  });

  it("drops directory entries that have no layout", () => {
    const repaired = repairState(brokenFromOpenRecent, defaults(), layout);
    expect(Object.keys(repaired.directories)).toEqual(["/work/project-a"]);
  });

  it("keeps project layouts that are still valid", () => {
    const savedLayout = layout();
    const repaired = repairState(
      { activeDirectory: "/work/a", directories: { "/work/b": { layout: savedLayout, activeEnv: "dev" } } },
      defaults(),
      layout,
    );
    expect(repaired.directories["/work/b"]).toEqual({ layout: savedLayout, activeEnv: "dev" });
    expect(repaired.directories["/work/a"].layout).toBeTruthy();
  });

  it("keeps Windows and Linux project paths as they are", () => {
    for (const project of ["C:\\Users\\dev\\api-tests", "/home/dev/api-tests", "\\\\server\\share\\api"]) {
      const repaired = repairState({ activeDirectory: project, directories: { [project]: { tabs: [] } } }, defaults(), layout);
      expect(repaired.activeDirectory).toBe(project);
      expect(Object.keys(repaired.directories)).toEqual([project]);
      expect(isUsableState(repaired)).toBe(true);
    }
  });

  it("falls back to the defaults when nothing can be kept", () => {
    const repaired = repairState(null, defaults(), layout);
    expect(repaired.activeDirectory).toBeNull();
    expect(repaired.directories).toEqual({});
    expect(isUsableState(repaired)).toBe(true);
  });
});
