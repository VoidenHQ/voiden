import type { Panel } from "@codemirror/view";

/**
 * CodeMirror's search state still needs a panel while Voiden renders its own
 * persistent search controls outside the editor. Keep that bridge panel out of
 * layout and explicitly place it at the top. An unspecified position defaults
 * to the bottom and is interpreted as a viewport-sized bottom scroll margin
 * when the surrounding panel group is hidden.
 */
export function createHiddenSearchPanel(): Panel {
  const dom = document.createElement("div");
  dom.hidden = true;
  return { dom, top: true };
}
