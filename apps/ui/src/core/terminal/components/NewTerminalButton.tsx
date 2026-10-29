import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Plus, RefreshCw, TerminalSquare } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { toast } from "@/core/components/ui/sonner";
import { Tip } from "@/core/components/ui/Tip";
import { setDefaultShell, useNewTerminalTab, useTerminalShells } from "@/core/terminal/hooks";
import { useGetPanelTabs } from "@/core/layout/hooks";

const MENU_WIDTH = 300;

/** "zsh", "pwsh", … — a custom shell's id is its full path, so use the file name. */
const shortShellName = (id: string) => id.split(/[\\/]/).pop()!.replace(/\.exe$/i, "");

/** Dropdown listing the installed shells, positioned under `anchor` and rendered into <body> so panels can't clip it. */
const ShellMenu = ({
  anchor,
  current,
  switching,
  onClose,
  onPick,
}: {
  anchor: HTMLElement;
  /** Shell of the active terminal, marked in the list. */
  current: string | null;
  /** True when picking restarts the active terminal; false when it opens a new one. */
  switching: boolean;
  onClose: () => void;
  onPick: (shell: string) => void;
}) => {
  const queryClient = useQueryClient();
  const { data, isLoading } = useTerminalShells();
  const [rescanning, setRescanning] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPos({ top: r.bottom + 4, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rescan = async () => {
    setRescanning(true);
    try {
      queryClient.setQueryData(["terminal:shells"], await window.electron?.terminal.listShells(true));
    } finally {
      setRescanning(false);
    }
  };

  const makeDefault = async (id: string, name: string) => {
    await setDefaultShell(id);
    toast.success(`${name} is now the default shell`, { description: "New terminals will start in it." });
  };

  if (!pos) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="fixed z-[9999] bg-editor border border-border rounded-md shadow-lg py-1"
        style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
        role="menu"
      >
        <div className="px-3 pt-1 pb-1.5 text-[11px] text-comment">
          {switching ? "Switch this terminal to" : "Open a new terminal in"}
        </div>
        {isLoading && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-comment">
            <Loader2 size={12} className="animate-spin" /> Finding shells…
          </div>
        )}
        {data?.shells.map((shell) => {
          const isDefault = shell.id === data.defaultId;
          const isCurrent = shell.id === current;
          return (
            <div
              key={shell.id}
              role="menuitem"
              tabIndex={0}
              onClick={() => onPick(shell.id)}
              onKeyDown={(e) => e.key === "Enter" && onPick(shell.id)}
              className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent/20 focus:bg-accent/20 outline-none"
              title={[shell.path, ...shell.args].join(" ")}
            >
              {isCurrent
                ? <Check size={13} className="flex-shrink-0 text-accent" />
                : <TerminalSquare size={13} className="flex-shrink-0 text-comment" />}
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-text truncate">{shell.name}</span>
                <span className="block text-[10px] text-comment truncate">{shell.path}</span>
              </span>
              {isDefault ? (
                <span className="flex items-center gap-1 text-[10px] text-accent flex-shrink-0">
                  <Check size={10} /> Default
                </span>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    makeDefault(shell.id, shell.name);
                  }}
                  className="text-[10px] text-comment hover:text-text px-1.5 py-0.5 rounded hover:bg-active opacity-0 group-hover:opacity-100 group-focus:opacity-100 flex-shrink-0"
                >
                  Set as default
                </button>
              )}
            </div>
          );
        })}
        {data && data.shells.length === 0 && <div className="px-3 py-2 text-xs text-comment">No shells found.</div>}
        <div className="border-t border-border my-1" />
        <button
          onClick={rescan}
          disabled={rescanning}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-comment hover:text-text hover:bg-accent/20 disabled:opacity-60"
        >
          <RefreshCw size={12} className={cn(rescanning && "animate-spin")} />
          Rescan installed shells
        </button>
      </div>
    </>,
    document.body,
  );
};

/**
 * "+" opens a terminal in the default shell; the shell picker beside it shows
 * the active terminal's shell and switches that terminal to another (#598). `variant="row"` is the full-width "New terminal" row used in
 * the stacked terminal list.
 */
export const NewTerminalButton = ({ panelId = "bottom", variant = "icon" }: { panelId?: string; variant?: "icon" | "row" }) => {
  const queryClient = useQueryClient();
  const { mutate: newTerminalTab } = useNewTerminalTab();
  // Cheap: file checks only, cached in the main process.
  const { data: shells } = useTerminalShells();
  const { data: panelTabs } = useGetPanelTabs(panelId);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  // The picker follows the active terminal: its own shell, or the default it started with.
  const activeTerminal = panelTabs?.tabs?.find((t: any) => t.id === panelTabs.activeTabId && t.type === "terminal");
  const defaultShell = shells?.defaultId ? shortShellName(shells.defaultId) : null;
  const currentShellId = activeTerminal ? (activeTerminal.meta?.shell || shells?.defaultId || null) : null;
  const label = currentShellId ? shortShellName(currentShellId) : defaultShell;

  const pickShell = async (shell: string) => {
    setMenuOpen(false);
    if (!activeTerminal) {
      newTerminalTab({ panelId, shell });
      return;
    }
    if (shell === currentShellId) return;
    try {
      await window.electron?.terminal.switchShell(activeTerminal.id, shell);
      queryClient.invalidateQueries({ queryKey: ["panel:tabs", panelId] });
    } catch (error: any) {
      toast.error("Couldn't switch shell", { description: error?.message ?? String(error) });
    }
  };

  // Shows the active terminal's shell, so it can't be mistaken for the "All tabs" chevron beside it.
  const shellPicker = (
    <Tip label={activeTerminal ? "Switch this terminal's shell" : "Choose a shell"} side="bottom">
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className={cn(
          "hover:bg-active text-comment hover:text-fg flex items-center gap-1 px-1.5",
          variant === "row" && "h-8 border-l border-border",
          menuOpen && "bg-active text-fg",
        )}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {label && <span className="text-xs font-mono max-w-[90px] truncate">{label}</span>}
        <ChevronDown size={11} className={cn("flex-shrink-0 transition-transform", menuOpen && "rotate-180")} />
      </button>
    </Tip>
  );

  return (
    <div ref={anchorRef} className={cn("flex", variant === "row" && "w-full border-b border-border")}>
      {variant === "icon" ? (
        <Tip label={defaultShell ? `New terminal (${defaultShell})` : "New terminal"} side="bottom">
          <button className="px-2 hover:bg-active text-comment" onClick={() => newTerminalTab(panelId)}>
            <Plus size={14} />
          </button>
        </Tip>
      ) : (
        <button
          onClick={() => newTerminalTab(panelId)}
          className="flex-1 flex items-center gap-1.5 h-8 px-2 text-comment hover:bg-active hover:text-fg"
        >
          <Plus size={11} className="flex-shrink-0" />
          <span className="text-xs">New terminal</span>
        </button>
      )}
      {shellPicker}
      {menuOpen && anchorRef.current && (
        <ShellMenu
          anchor={anchorRef.current}
          current={currentShellId}
          switching={!!activeTerminal}
          onClose={() => setMenuOpen(false)}
          onPick={pickShell}
        />
      )}
    </div>
  );
};
