import { useAddPanelTab } from "@/core/layout/hooks";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

export const ConflictResolver = ({ conflicted }: { conflicted: string[] }) => {
  const { mutate: addPanelTab } = useAddPanelTab();
  const [open, setOpen] = useState(true);

  if (conflicted.length === 0) return null;

  const handleOpen = (file: string) => {
    const fileName = file.split("/").pop() || file;
    addPanelTab({
      panelId: "main",
      tab: {
        id: `conflict-${file}`,
        type: "conflict",
        title: `Conflict: ${fileName}`,
        source: file,
      } as any,
    });
  };

  return (
    <div className="border-b border-border">
      {/* Section header */}
      <div
        className="px-3 py-1.5 bg-orange-500/10 border-b border-border flex items-center gap-1.5 cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        {open
          ? <ChevronDown size={11} className="text-orange-400" />
          : <ChevronRight size={11} className="text-orange-400" />}
        <AlertTriangle size={11} className="text-orange-400" />
        <span className="text-[10px] uppercase tracking-wide text-orange-400 font-medium flex-1">
          Conflicts ({conflicted.length})
        </span>
        <span className="text-[10px] text-orange-400/60">click to resolve</span>
      </div>

      {open && (
        <div>
          {conflicted.map((file) => {
            const fileName = file.split("/").pop() || file;
            return (
              <div
                key={file}
                onClick={() => handleOpen(file)}
                className="ml-2 flex items-center gap-2 px-3 py-1.5 hover:bg-active/50 cursor-pointer group"
              >
                <AlertTriangle size={12} className="text-orange-400 flex-shrink-0" />
                <span className="text-xs text-text flex-1 truncate">{fileName}</span>
                <span className="text-[10px] text-orange-400/60 opacity-0 group-hover:opacity-100 transition-opacity">
                  Open →
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
