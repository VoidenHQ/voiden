import { afterEach, describe, expect, it, vi } from "vitest";
import { openSearchPanel, search } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { createHiddenSearchPanel } from "../lib/createHiddenSearchPanel";

const mountedViews: EditorView[] = [];

afterEach(() => {
  mountedViews.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

describe("createHiddenSearchPanel", () => {
  it("keeps CodeMirror's bridge panel hidden and out of the bottom panel group", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      doc: "alpha\nbeta",
      extensions: [search({ top: true, createPanel: createHiddenSearchPanel })],
      parent,
    });
    mountedViews.push(view);

    openSearchPanel(view);

    vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 800,
      bottom: 720,
      left: 0,
      width: 800,
      height: 720,
      toJSON: () => ({}),
    });

    const panel = view.dom.querySelector<HTMLElement>(".cm-panel");
    const margins = view.state
      .facet(EditorView.scrollMargins)
      .map((source) => source(view));
    expect(panel?.hidden).toBe(true);
    expect(view.dom.querySelector(".cm-panels-top")).not.toBeNull();
    expect(view.dom.querySelector(".cm-panels-bottom")).toBeNull();
    expect(Math.max(0, ...margins.map((margin) => margin?.bottom ?? 0))).toBe(0);
  });
});
