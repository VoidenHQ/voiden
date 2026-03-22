import { useHotkeys } from "react-hotkeys-hook";
import { useSendRequest } from "@/core/request-engine"
import { useVoidenEditorStore } from "@/core/editors/voiden/VoidenEditor.tsx";
import { Loader, Play, PlayCircle } from "lucide-react";
import { cn } from "@/core/lib/utils";

export function SendRequestButton() {
  const editor = useVoidenEditorStore((state) => state.editor);
  // @ts-ignore
  const { refetch, isFetching, cancelRequest, runAll } = useSendRequest(editor);

  useHotkeys(
    "mod+enter",
    () => {
      if (editor) {
        handleSend();
      }
    },
    {
      enableOnFormTags:true,
      enableOnContentEditable: true,
      preventDefault:true,
    },
  );

  // Cmd+Shift+Enter → Run All sections sequentially
  useHotkeys(
    "mod+shift+enter",
    () => {
      if (editor) {
        handleRunAll();
      }
    },
    {
      enableOnFormTags: true,
      enableOnContentEditable: true,
      preventDefault: true,
    },
  );

  const handleSend = () => {
    if (!editor) return;

    if (isFetching) {
      cancelRequest();
      return;
    }
    refetch();
  };

  const handleRunAll = () => {
    if (!editor) return;

    if (isFetching) {
      cancelRequest();
      return;
    }
    runAll();
  };

  // Check if document has multiple sections
  let hasMultipleSections = false;
  if (editor) {
    editor.state.doc.forEach((child: any) => {
      if (child.type.name === "request-separator") hasMultipleSections = true;
    });
  }

  return (
    <>
      {hasMultipleSections && (
        <button
          className={cn("bg-bg px-2 py-1 h-full flex items-center gap-1.5 border-l border-border hover:bg-active text-xs")}
          onClick={handleRunAll}
          disabled={!editor}
          title="Run all requests (⌘⇧↵)"
          style={
            !editor
              ? { opacity: 0.5, cursor: 'not-allowed' }
              : !isFetching
              ? { color: 'var(--icon-success)' }
              : undefined
          }
        >
          {isFetching ? <Loader className="animate-spin" size={14} /> : <PlayCircle size={14} />}
          <span className="font-medium">All</span>
        </button>
      )}
      <button
        className={cn("bg-bg px-2 py-1  h-full flex items-center gap-2 border-l border-border hover:bg-active")}
        onClick={handleSend}
        disabled={!editor}
        style={
          !editor
            ? { opacity: 0.5, cursor: 'not-allowed' }
            : !isFetching
            ? { color: 'var(--icon-success)' }
            : undefined
        }
      >
        {isFetching ? <Loader className="animate-spin" size={14} /> : <Play size={14} />}
      </button>
    </>
  );
}
