import { LocateFixed, RotateCw } from "lucide-react";
import { Tip } from "@/core/components/ui/Tip";
import { toast } from "@/core/components/ui/sonner";
import { useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor";
import { useSendRequest } from "../hooks";

const BUTTON = "p-1 text-comment hover:text-text transition-colors rounded flex-shrink-0 disabled:opacity-40 disabled:hover:text-comment";

/**
 * Position of a section's first block: the top of the document for section 0, else the block
 * right after the Nth request separator (or the separator itself, if nothing follows it).
 */
function sectionFirstBlockPos(doc: any, sectionIndex: number): number | null {
  if (sectionIndex <= 0) return 0;
  let seen = 0;
  let found: number | null = null;
  doc.forEach((child: any, offset: number) => {
    if (found !== null || child.type.name !== "request-separator" || ++seen !== sectionIndex) return;
    const after = offset + child.nodeSize;
    found = after < doc.content.size ? after : offset;
  });
  return found;
}

/**
 * Per-section actions in the response panel's header: jump to the request in the editor,
 * and send it again. They act on the open document, so they're disabled
 * when the editor shows a different tab than this response belongs to.
 */
export function SectionHeaderActions({
  tabId,
  sectionIndex,
  size = 12,
  showJump = true,
}: {
  tabId: string;
  sectionIndex: number;
  size?: number;
  /** Only useful once several requests have responses in the panel. */
  showJump?: boolean;
}) {
  const editor = useVoidenEditorStore((s) => s.editor);
  const { runSection } = useSendRequest(editor as any);
  const live = editor && !editor.isDestroyed && editor.storage?.tabId === tabId ? editor : null;

  const jump = () => {
    if (!live) return;
    const pos = sectionFirstBlockPos(live.state.doc, sectionIndex);
    if (pos === null) {
      toast.info("That request isn't in the file anymore");
      return;
    }
    // The editor's own handler (shared with the Block Overview panel) selects the block and
    // scrolls its real container, without the editor's scroll memory pulling it back.
    window.dispatchEvent(new CustomEvent("voiden:scroll-to-block-pos", { detail: { pos } }));
  };

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    // The header itself toggles collapse; these buttons shouldn't.
    e.stopPropagation();
    fn();
  };
  const notHere = live ? undefined : "Open this request's file to use this";

  return (
    <>
      {showJump && (
        <Tip label={notHere ?? "Jump to request"} side="bottom">
          <button type="button" className={BUTTON} disabled={!live} onClick={stop(jump)} aria-label="Jump to request">
            <LocateFixed size={size} />
          </button>
        </Tip>
      )}
      <Tip label={notHere ?? "Send this request again"} side="bottom">
        <button type="button" className={BUTTON} disabled={!live} onClick={stop(() => runSection(sectionIndex))} aria-label="Retry request">
          <RotateCw size={size} />
        </button>
      </Tip>
    </>
  );
}
