import { useEffect } from "react";
import { subscribePluginEvent } from "@/plugins";
import { useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { toast } from "@/core/components/ui/sonner";
import { markGettingStartedStep, saveTourFiles, stepById, useGettingStartedStore } from "./gettingStartedStore";

/** What the open document contains that the tour cares about. */
function readActiveDocument() {
  const found = { headers: false, linked: false };
  const editor = useVoidenEditorStore.getState().editor;
  if (!editor || editor.isDestroyed) return found;
  editor.state.doc.descendants((node: any) => {
    const type = node.type.name;
    if (type === "headers-table") found.headers = true;
    // A single block picked with @, or a whole file imported with @: both reuse another file.
    else if (type === "linkedBlock" || type === "linkedFile") found.linked = true;
    return !(found.headers && found.linked);
  });
  return found;
}

/**
 * Listens to app events and marks Getting started steps done. Headers and reuse count as soon
 * as their block is in the step's file, sent or not.
 * Commit, writing an env variable and "run outside" are marked where those actions happen.
 */
export function useGettingStartedTracking() {
  useEffect(() => {
    const unsubs = [
      subscribePluginEvent("response:received", () => {
        const state = useGettingStartedStore.getState();
        // Outside the tour, still celebrate the very first response.
        if (!state.done.send && state.tipStep !== "send") {
          toast.success("Nice, that's your first response", { description: "It's in the response panel, and also saved in History." });
        }
        markGettingStartedStep("send");
        const doc = readActiveDocument();
        if (doc.headers) markGettingStartedStep("headers");
        if (doc.linked) markGettingStartedStep("reuse");
        // Keep what was just sent on disk, so the next step's @ picker can see it.
        saveTourFiles();
      }),
      subscribePluginEvent("environment:changed", () => markGettingStartedStep("selectEnv")),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // "Add a headers block" and "Reuse a block with @" are done once their block is in the
  // step's tour file, sent or not.
  const editor = useVoidenEditorStore((s) => s.editor);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const inFile = (id: "headers" | "reuse") =>
      ((editor.storage?.source ?? "") as string).replace(/\\/g, "/").endsWith(`/${stepById(id).file}`);
    const check = () => {
      const { done } = useGettingStartedStore.getState();
      if (done.headers && done.reuse) return;
      const doc = readActiveDocument();
      if (!done.headers && doc.headers && inFile("headers")) markGettingStartedStep("headers");
      if (!done.reuse && doc.linked && inFile("reuse")) markGettingStartedStep("reuse");
    };
    check();
    editor.on("update", check);
    return () => {
      editor.off("update", check);
    };
  }, [editor]);
}
