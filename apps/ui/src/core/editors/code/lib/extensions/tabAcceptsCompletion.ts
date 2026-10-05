import { acceptCompletion } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";

/**
 * Tab accepts the open completion, like Enter. acceptCompletion returns false
 * when no completion is open, so Tab keeps its normal behavior otherwise.
 */
export const tabAcceptsCompletion = Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }]));
