import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  get: async (k: string) => disk.get(k),
  set: async (k: string, v: unknown) => void disk.set(k, structuredClone(v)),
  del: async (k: string) => void disk.delete(k),
}));

const { useResponseRunsStore, runKey } = await import("../responseRunsStore");
const { useResponseStore } = await import("../responseStore");

const doc = (body: string, status = 200) => ({
  type: "doc",
  attrs: { statusCode: status },
  content: [{ type: "response-doc", content: [{ type: "response-body", attrs: { body } }] }],
});

const flush = () => new Promise((r) => setTimeout(r, 450));

beforeEach(() => {
  disk.clear();
  useResponseRunsStore.setState({ runs: {}, nextId: {}, compareOpen: {}, tabSources: {}, lastDocs: {} });
});

describe("responseRunsStore persistence", () => {
  it("saves live runs per file path and loads them into a new tab", async () => {
    const store = useResponseRunsStore.getState();
    await store.linkTab("tab-1", "/proj/users.void");
    store.record("tab-1", 0, doc("one"));
    store.record("tab-1", 0, doc("two"));
    await flush();

    const saved = disk.get("/proj/users.void") as any;
    expect(saved.sections[0].runs.map((r: any) => r.bodyText)).toEqual(["two", "one"]);
    // The latest full response is kept too, for the response panel.
    expect(saved.sections[0].doc.content[0].content[0].attrs.body).toBe("two");

    // App restart: memory is gone, a new tab id opens the same file.
    useResponseRunsStore.setState({ runs: {}, nextId: {}, tabSources: {}, lastDocs: {} });
    useResponseStore.setState({ responses: {} });
    await useResponseRunsStore.getState().linkTab("tab-2", "/proj/users.void");
    const runs = useResponseRunsStore.getState().runs[runKey("tab-2", 0)];
    expect(runs.map((r) => [r.id, r.bodyText])).toEqual([[2, "two"], [1, "one"]]);

    // The panel gets the last response back, with its original time.
    const restored = useResponseStore.getState().responses["tab-2"]?.[0];
    expect(restored?.responseDoc?.content?.[0]?.content?.[0]?.attrs?.body).toBe("two");
    expect(restored?.timestamp).toBe(runs[0].timestamp);

    // New runs keep counting after the saved ones.
    useResponseRunsStore.getState().record("tab-2", 0, doc("three"));
    expect(useResponseRunsStore.getState().runs[runKey("tab-2", 0)][0].id).toBe(3);
  });

  it("does not save the response that was loaded from the file", async () => {
    const store = useResponseRunsStore.getState();
    await store.linkTab("t", "/proj/a.void");
    store.record("t", 0, doc("from file"), "file");
    await flush();
    expect(disk.has("/proj/a.void")).toBe(false);
  });

  it("saves runs made before the tab was linked, and drops the file baseline once saved runs load", async () => {
    disk.set("/proj/b.void", { 0: [{ id: 1, timestamp: 1, source: "live", headers: [], bodyText: "old", bytes: 3, binary: false }] });
    const store = useResponseRunsStore.getState();
    store.record("t", 0, doc("file copy"), "file");
    store.record("t", 1, doc("early"));
    await store.linkTab("t", "/proj/b.void");
    await flush();

    const s = useResponseRunsStore.getState();
    expect(s.runs[runKey("t", 0)].map((r) => r.bodyText)).toEqual(["old"]);
    expect(Object.keys((disk.get("/proj/b.void") as any).sections).sort()).toEqual(["0", "1"]);
  });

  it("forgets a request's runs on disk too", async () => {
    const store = useResponseRunsStore.getState();
    await store.linkTab("t", "/proj/c.void");
    store.record("t", 0, doc("x"));
    await flush();
    store.forgetRuns("t", 0);
    await flush();
    expect(disk.has("/proj/c.void")).toBe(false);
  });
});
