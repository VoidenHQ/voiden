import { useEffect } from "react";
import { subscribePluginEvent } from "@/plugins";
import { useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { toast } from "@/core/components/ui/sonner";
import { markGettingStartedStep, saveTourFiles, useGettingStartedStore } from "./gettingStartedStore";

/** What the open document contains that the tour cares about. */
function readActiveDocument() {
  const found = { headers: false, linked: false, formFile: false, binaryFile: false };
  const editor = useVoidenEditorStore.getState().editor;
  if (!editor || editor.isDestroyed) return found;
  editor.state.doc.descendants((node: any) => {
    const type = node.type.name;
    if (type === "headers-table") found.headers = true;
    else if (type === "linkedBlock") found.linked = true;
    else if (type === "multipart-table" || type === "restFile") {
      let hasFile = false;
      node.descendants((child: any) => {
        if (child.type.name === "fileLink") hasFile = true;
        return !hasFile;
      });
      if (hasFile) found[type === "restFile" ? "binaryFile" : "formFile"] = true;
    }
    return true;
  });
  return found;
}

/**
 * Listens to app events and marks Getting started steps done. Steps that are about
 * sending something (headers, a form, a file) count once a response comes back with it.
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
        if (doc.formFile) markGettingStartedStep("form");
        if (doc.binaryFile) markGettingStartedStep("binary");
        // Keep what was just sent on disk, so the next step's @ picker can see it.
        saveTourFiles();
      }),
      subscribePluginEvent("environment:changed", () => markGettingStartedStep("selectEnv")),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);
}
