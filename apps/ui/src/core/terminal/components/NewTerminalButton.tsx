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
/** Gap kept between the menu and the window edge. */
const EDGE = 8;

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
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);

  // Open below the button, or above it when there's more room there (the terminal panel often
  // sits at the bottom of the window), and never taller than that space: the list scrolls instead.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const left = Math.max(EDGE, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - EDGE));
      const below = window.innerHeight - r.bottom - 4 - EDGE;
      const above = r.top - 4 - EDGE;
      setPos(
        below >= 240 || below >= above
          ? { top: r.bottom + 4, left, maxHeight: below }
          : { bottom: window.innerHeight - r.top + 4, left, maxHeight: above },
      );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
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
        className="fixed z-[9999] flex flex-col bg-editor border border-border rounded-md shadow-lg py-1"
        style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: MENU_WIDTH, maxHeight: pos.maxHeight }}
        role="menu"
      >
        <div className="flex-shrink-0 px-3 pt-1 pb-1.5 text-[11px] text-comment">
          {switching ? "Switch this terminal to" : "Open a new terminal in"}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
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
              aria-current={isCurrent || undefined}
              className={cn(
                "group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent/20 focus:bg-accent/20 outline-none",
                isCurrent && "bg-active",
              )}
              title={[shell.path, ...shell.args].join(" ")}
            >
              {isCurrent
                ? <Check size={13} className="flex-shrink-0 text-accent" />
                : <TerminalSquare size={13} className="flex-shrink-0 text-comment" />}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-xs text-text truncate", isCurrent && "font-semibold")}>{shell.name}</span>
                <span className="block text-[10px] text-comment truncate">{shell.path}</span>
              </span>
              {/* A plain tag, not a check: the check marks the shell this terminal is in, which may not be the default. */}
              {isDefault ? (
                <span className="text-[10px] text-comment border border-border rounded px-1.5 py-0.5 flex-shrink-0">Default</span>
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
        </div>
        <div className="border-t border-border my-1 flex-shrink-0" />
        <button
          onClick={rescan}
          disabled={rescanning}
          className="w-full flex flex-shrink-0 items-center gap-2 px-3 py-1.5 text-xs text-comment hover:text-text hover:bg-accent/20 disabled:opacity-60"
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
