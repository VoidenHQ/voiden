import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "@/core/components/ui/sonner";
import { useClosePanelTab } from "@/core/layout/hooks";
import { getGitErrorMessage } from "@/core/git/utils/gitErrorMessage";
import { formatSize } from "@/utils/format";
import type { FileBlob } from "@/core/git/hooks";
import { ImageDiff } from "./BinaryDiffView";
import { useTabGitRepo } from "../repoContext";

type Side = "current" | "incoming";

const sideText = (blob?: FileBlob | null) => (blob?.exists ? formatSize(blob.size) : "Deleted on this side");

interface BinaryConflictViewProps {
  file: string;
  tabId: string;
  current?: FileBlob | null;
  incoming?: FileBlob | null;
}

/**
 * A conflict in an image or other binary file (#610). It cannot be merged line
 * by line, so the user keeps one whole version; saving it as text would break it.
 */
export const BinaryConflictView = ({ file, tabId, current, incoming }: BinaryConflictViewProps) => {
  const queryClient = useQueryClient();
  const repo = useTabGitRepo();
  const { mutate: closeTab } = useClosePanelTab();
  const [saving, setSaving] = useState<Side | null>(null);
  const fileName = file.split("/").pop() || file;
  const blob = current?.exists ? current : incoming;
  const isImage = !!(current?.dataUrl || incoming?.dataUrl);

  const keep = async (side: Side) => {
    setSaving(side);
    try {
      await window.electron?.git.resolveBinaryConflict(file, side, repo);
      queryClient.invalidateQueries({ queryKey: ["git:conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["git:status"] });
      queryClient.invalidateQueries({ queryKey: ["git:file:blob"] });
      toast.success("File resolved & staged", { description: `${fileName}: kept the ${side} version` });
      if (tabId) closeTab({ panelId: "main", tabId });
    } catch (error) {
      toast.error("Could not resolve the conflict", { description: getGitErrorMessage(error) });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg">
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-border flex items-center gap-2 min-w-0">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
        <span className="text-sm text-text truncate">{fileName}</span>
        <span className="text-[11px] text-comment flex-shrink-0">{blob?.label ?? "Binary file"}</span>
      </div>

      {isImage ? (
        <ImageDiff
          base={current}
          compare={incoming}
          baseLabel="Current"
          compareLabel="Incoming"
          notes={["your branch", "being merged in"]}
          title="Both branches changed this image. Keep one version."
          mode="split"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-lg border border-border bg-panel/40 px-6 py-6 text-center space-y-3">
            <p className="text-sm text-text">Both branches changed this {blob?.label?.toLowerCase() ?? "file"}.</p>
            <p className="text-xs text-comment">Changes to this file type can't be merged. Keep one version.</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded border border-border px-3 py-2">
                <p className="text-vcs-removed">Current</p>
                <p className="text-text mt-0.5">{sideText(current)}</p>
              </div>
              <div className="rounded border border-border px-3 py-2">
                <p className="text-vcs-added">Incoming</p>
                <p className="text-text mt-0.5">{sideText(incoming)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-shrink-0 px-4 py-2 border-t border-border bg-panel flex items-center justify-end gap-2 flex-wrap">
        {(["current", "incoming"] as const).map((side) => (
          <button
            key={side}
            onClick={() => keep(side)}
            disabled={saving !== null}
            className="flex items-center gap-1.5 text-xs text-white bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-1.5 rounded transition-colors font-medium whitespace-nowrap"
          >
            {saving === side ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Keep {side === "current" ? "Current" : "Incoming"}
          </button>
        ))}
      </div>
    </div>
  );
};
