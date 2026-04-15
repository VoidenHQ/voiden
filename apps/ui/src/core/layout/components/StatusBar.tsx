import { PanelLeft, Terminal, Github, MessageCircle, PanelRight, GitCompareArrows, Download, icons, Activity, X, GripHorizontal, Trash2, Logs, Lock, Unlock } from "lucide-react";
import { useProjectLock } from "@/core/file-system/hooks";
import { cn, isMac } from "@/core/lib/utils";
import { GitBranchesList } from "@/core/git/components/GitBranchesList";
import { BranchComparisonDialog } from "@/core/git/components/BranchComparisonDialog";
import { useSettings } from "@/core/settings/hooks/useSettings";
import { usePanelStore } from "@/core/stores/panelStore";
import { useResponsePanelPosition } from "@/core/stores/responsePanelPosition";
import { useNewTerminalTab } from "@/core/terminal/hooks";
import { useGetPanelTabs, useActivateTab, useAddPanelTab } from "@/core/layout/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";
import { usePluginStore } from "@/plugins";
import type { StatusBarItem } from "@voiden/sdk/ui";
import { matchesShortcut, getShortcutLabel } from "@/core/shortcuts";

const handleExternalLink = (url: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  window.electron?.openExternal?.(url);
};

const renderStatusBarIcon = (icon: StatusBarItem['icon'], size: number = 14) => {
  if (typeof icon === 'string') {
    const IconComponent = icons[icon as keyof typeof icons];
    if (!IconComponent) return null;
    return <IconComponent size={size} />;
  }
  const IconComponent = icon;
  return <IconComponent size={size} />;
};

// ── Process Monitor (floating) ────────────────────────────────────────────────

interface TrackedProcess {
  id: string;
  channel: string;
  category: string;
  startTime: number;
  status: 'active' | 'done' | 'error';
  duration?: number;
  error?: string;
}

function elapsed(startTime: number): string {
  const ms = Date.now() - startTime;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function categoryColor(category: string): string {
  switch (category) {
    case 'git': return 'text-orange-400';
    case 'filesystem': return 'text-blue-400';
    case 'state': return 'text-cyan-400';
    case 'plugin': return 'text-green-400';
    default: return 'text-purple-400';
  }
}

function useProcesses() {
  const [processes, setProcesses] = useState<TrackedProcess[]>([]);

  useEffect(() => {
    window.electron?.processMonitor?.getActive?.().then((p) => setProcesses(p || []));
    const unsub = window.electron?.processMonitor?.subscribe?.((p: TrackedProcess[]) => setProcesses(p));
    return unsub;
  }, []);

  // Tick every 100ms while there are active processes so elapsed time updates
  useEffect(() => {
    const hasActive = processes.some((p) => p.status === 'active');
    if (!hasActive) return;
    const id = setInterval(() => setProcesses((prev) => [...prev]), 100);
    return () => clearInterval(id);
  }, [processes]);

  return {
    active: processes.filter((p) => p.status === 'active'),
    recent: processes.filter((p) => p.status !== 'active'),
  };
}

function FloatingProcessMonitor({ onClose }: { onClose: () => void }) {
  const { active, recent } = useProcesses();

  const handleClearHistory = () => {
    window.electron?.processMonitor?.clearHistory?.();
  };

  const [pos, setPos] = useState(() => ({
    x: window.innerWidth - 400 - 24,
    y: window.innerHeight - 360 - 40, // just above status bar
  }));
  const [size, setSize] = useState({ w: 400, h: 340 });

  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const resizing = useRef(false);
  const resizeStart = useRef({ mx: 0, my: 0, w: 0, h: 0 });

  const onDragDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: Math.max(0, dragStart.current.px + ev.clientX - dragStart.current.mx),
        y: Math.max(0, dragStart.current.py + ev.clientY - dragStart.current.my),
      });
    };
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  const onResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    resizeStart.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      setSize({
        w: Math.max(280, resizeStart.current.w + ev.clientX - resizeStart.current.mx),
        h: Math.max(160, resizeStart.current.h + ev.clientY - resizeStart.current.my),
      });
    };
    const onUp = () => { resizing.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size]);

  const el = (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 9999 }}
      className="flex flex-col bg-bg border border-border rounded-lg shadow-2xl overflow-hidden font-mono text-xs select-none"
    >
      {/* Title bar */}
      <div
        onMouseDown={onDragDown}
        className="flex items-center gap-2 px-3 py-1.5 bg-active border-b border-border cursor-grab active:cursor-grabbing flex-shrink-0"
      >
        <GripHorizontal size={12} className="text-comment flex-shrink-0" />
        <Activity size={12} className="text-comment flex-shrink-0" />
        <span className="text-[11px] text-comment flex-1 uppercase tracking-wider">Process Monitor</span>
        {active.length > 0 && (
          <span className="text-[10px] bg-yellow-400/20 text-yellow-300 px-1.5 py-0.5 rounded-full tabular-nums">
            {active.length} active
          </span>
        )}
        <Tip label="Clear history" side="top">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleClearHistory}
            className="p-1 rounded text-comment hover:text-text hover:bg-border transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </Tip>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="p-1 rounded text-comment hover:text-text hover:bg-border transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-editor">
        {active.length === 0 && recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-comment gap-2">
            <Activity size={18} className="opacity-40" />
            <span className="text-xs">No active processes</span>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {active.length > 0 && (
              <>
                <div className="text-[10px] text-comment uppercase tracking-wider px-2 py-1">Active ({active.length})</div>
                {active.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-active border border-border">
                    <span className="relative flex h-2 w-2 flex-shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-400" />
                    </span>
                    <span className={`flex-shrink-0 w-20 truncate ${categoryColor(p.category)}`}>{p.category}</span>
                    <span className="flex-1 truncate text-text">{p.channel}</span>
                    <span className="flex-shrink-0 text-yellow-300 tabular-nums">{elapsed(p.startTime)}</span>
                  </div>
                ))}
              </>
            )}
            {recent.length > 0 && (
              <>
                <div className="text-[10px] text-comment uppercase tracking-wider px-2 py-1 mt-2">History ({recent.length})</div>
                {recent.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-border/50 opacity-70">
                    <span className={`flex-shrink-0 h-2 w-2 rounded-full ${p.status === 'error' ? 'bg-red-400' : 'bg-green-400'}`} />
                    <span className={`flex-shrink-0 w-20 truncate ${categoryColor(p.category)}`}>{p.category}</span>
                    <span className="flex-1 truncate text-text">{p.channel}</span>
                    {p.error ? (
                      <Tip label={p.error} side="top">
                        <span className="flex-shrink-0 text-red-400 tabular-nums">{p.duration}ms ⚠</span>
                      </Tip>
                    ) : (
                      <span className="flex-shrink-0 text-green-400 tabular-nums">{p.duration}ms</span>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onResizeDown}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize opacity-40 hover:opacity-100"
        style={{ backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)', backgroundSize: '3px 3px', backgroundPosition: 'bottom right', color: 'var(--color-comment, #888)' }}
      />
    </div>
  );

  return ReactDOM.createPortal(el, document.body);
}

// ── StatusBar ─────────────────────────────────────────────────────────────────

interface StatusBarProps {
  version: string;
  isLeftCollapsed: boolean;
  isBottomCollapsed: boolean;
  isRightCollapsed: boolean;
  toggleLeft: () => void;
  toggleBottom: () => void;
  toggleRight: () => void;
}

export const StatusBar = ({
  version,
  isLeftCollapsed,
  isBottomCollapsed,
  isRightCollapsed,
  toggleLeft,
  toggleBottom,
  toggleRight,
}: StatusBarProps) => {
  const { settings } = useSettings();
  const { position: responsePanelPosition } = useResponsePanelPosition();
  const { openBottomPanel, bottomPanelRef, setBottomActiveView } = usePanelStore();
  const bottomActiveView = usePanelStore((state) => state.bottomActiveView);
  const setBottomOpenedByTerminal = usePanelStore((state) => state.setBottomOpenedByTerminal);
  const { mutate: newTerminalTab } = useNewTerminalTab();
  const { mutate: activateTab } = useActivateTab();
  const { data: bottomPanelData } = useGetPanelTabs("bottom");
  const { data: mainPanelData } = useGetPanelTabs("main");
  const queryClient = useQueryClient();
  const { projectRoot, locked: isProjectLocked, toggle: toggleProjectLock, isToggling: isTogglingLock } = useProjectLock();
  const statusBarItems = usePluginStore((state) => state.statusBarItems);
  const leftItems = statusBarItems.filter((item) => item.position === 'left');
  const rightItems = statusBarItems.filter((item) => item.position === 'right');
  const { mutate: addPanelTab } = useAddPanelTab();
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [isCompareDialogOpen, setIsCompareDialogOpen] = useState(false);
  const [memStats, setMemStats] = useState<{ heap: number; processes: { type: string; mb: number; cpu: number }[] } | null>(null);
  const [updateProgress, setUpdateProgress] = useState<{ percent?: number; bytesPerSecond?: number; transferred?: number; total?: number; status: string } | null>(null);

  const handleCheckForUpdates = async () => {
    if (isCheckingUpdates) return;

    setIsCheckingUpdates(true);
    try {
      const channel = settings.updates?.channel || "stable";
      await window.electron?.checkForUpdates(channel);
    } catch (error) {
      console.error("Failed to check for updates:", error);
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  // Listen for update progress
  useEffect(() => {
    const unsubscribe = window.electron?.onUpdateProgress?.((progress) => {
      setUpdateProgress(progress);

      // Clear progress after completion or error
      if (progress.status === "installed" || progress.status === "error" || progress.status === "idle") {
        setTimeout(() => setUpdateProgress(null), 3000);
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);


  // Memory stats: JS heap (renderer) + all Electron process metrics (main, GPU, etc.)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perf = performance as any;
    const update = async () => {
      const heap = perf.memory ? perf.memory.usedJSHeapSize / 1024 / 1024 : 0;
      const raw: { type: string; memory: number; cpu: number }[] = await window.electron?.ipc?.invoke("app:metrics") ?? [];
      // Merge duplicate types (e.g. multiple Tab processes), convert KB → MB, sum CPU
      const merged: Record<string, { mb: number; cpu: number }> = {};
      for (const p of raw) {
        const cur = merged[p.type] ?? { mb: 0, cpu: 0 };
        merged[p.type] = { mb: cur.mb + p.memory / 1024, cpu: cur.cpu + p.cpu };
      }
      const processes = Object.entries(merged).map(([type, v]) => ({ type, ...v }));
      setMemStats({ heap, processes });
    };
    update();
    const id = setInterval(update, 2000);
    return () => clearInterval(id);
  }, []);

  // Keyboard shortcut for compare branches: ⌥⌘D (Mac) or Alt+Ctrl+D (Windows/Linux)
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      // Don't trigger if focus is in a CodeMirror editor
      const target = event.target as HTMLElement;
      if (target?.closest('.cm-editor, .txt-editor')) {
        return;
      }

      if (matchesShortcut("ToggleCompareBranches", event)) {
        event.preventDefault();
        setIsCompareDialogOpen((open) => !open);
        return;
      }

      // TODO: Duplicate shortcut for toggle sidebar?
      if (matchesShortcut("ToggleSidebar", event)) {
        event.preventDefault();
        event.stopPropagation();
        toggleLeft();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <>
    <div className="h-8 flex-none border-t border-border flex items-center justify-between bg-panel">
      {/* Left Status Items */}
      <div className="flex items-center h-full">
        <Tip label={<span className="flex items-center gap-2"><span>Toggle left panel</span><Kbd keys={getShortcutLabel("ToggleSidebar")} size="sm" /></span>}>
          <button className={cn("h-full px-2 hover:bg-active text-comment", !isLeftCollapsed && "bg-active")} onClick={toggleLeft}>
            <PanelLeft size={14} />
          </button>
        </Tip>

        <GitBranchesList />

        <Tip label={<span className="flex items-center gap-2"><span>Compare branches</span><Kbd keys={getShortcutLabel("ToggleCompareBranches")} size="sm" /></span>}>
          <button
            className={cn("text-sm h-full px-2 flex items-center gap-2 hover:bg-active no-drag text-comment")}
            onClick={() => setIsCompareDialogOpen(true)}
          >
            <GitCompareArrows size={14} />
            <span>Compare</span>
          </button>
        </Tip>

        {/* Plugin Status Bar Items (Left) */}
        {leftItems.map((item) => (
          <Tip key={item.id} label={item.tooltip}>
            <button
              className="text-sm h-full px-2 flex items-center gap-2 hover:bg-active no-drag text-comment"
              onClick={item.onClick}
            >
              {renderStatusBarIcon(item.icon)}
              {item.label && <span>{item.label}</span>}
            </button>
          </Tip>
        ))}
      </div>

      {/* Right Status Items */}
      <div className="flex items-center space-x-2 h-full">
        <div className="flex h-full justify-between">
          {/* Plugin Status Bar Items (Right) */}
          {rightItems.map((item) => (
            <Tip key={item.id} label={item.tooltip} align="end">
              <button
                className="h-full px-2 hover:bg-active text-comment flex items-center gap-2"
                onClick={item.onClick}
              >
                {renderStatusBarIcon(item.icon)}
                {item.label && <span className="text-sm">{item.label}</span>}
              </button>
            </Tip>
          ))}

          {/* Project Lock */}
          {projectRoot && (
            <Tip
              label={
                isProjectLocked
                  ? "Project is locked — saves are blocked. Click to unlock."
                  : "Click to lock this project and prevent writes to .void files."
              }
              align="end"
            >
              <button
                onClick={() => { void toggleProjectLock(); }}
                disabled={isTogglingLock}
                className={cn(
                  "h-full px-2 flex items-center gap-1.5 hover:bg-active transition-colors",
                  isProjectLocked ? "text-accent" : "text-comment",
                  isTogglingLock && "opacity-60 cursor-wait",
                )}
              >
                {isProjectLocked ? <Lock size={13} /> : <Unlock size={13} />}
                <span className="text-xs">{isProjectLocked ? "Locked" : "Unlocked"}</span>
              </button>
            </Tip>
          )}

          {/* Memory / CPU */}
          {memStats && (() => {
            const totalMB = memStats.processes.reduce((s, p) => s + p.mb, 0);
            const totalCPU = memStats.processes.reduce((s, p) => s + p.cpu, 0);
            return (
              <>
              <Tip label={
                <div className="space-y-1 min-w-[240px]">
                  <div className="flex justify-between gap-4 font-medium">
                    <span>JS heap (actual app usage)</span>
                    <span>{memStats.heap.toFixed(1)} MB</span>
                  </div>
                  <div className="border-t border-border pt-1 mt-1 space-y-1">
                    <div className="text-comment text-xs mb-1">Per-process breakdown — shared Chromium code counted once per process</div>
                    <div className="flex justify-between gap-4 text-comment text-xs font-medium">
                      <span>Process</span>
                      <span className="flex gap-4"><span>RAM</span><span>CPU</span></span>
                    </div>
                    {memStats.processes.map(p => (
                      <div key={p.type} className="flex justify-between gap-4 text-comment">
                        <span>{p.type}</span>
                        <span className="flex gap-4">
                          <span>{p.mb.toFixed(1)} MB</span>
                          <span>{p.cpu.toFixed(1)}%</span>
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between gap-4 pt-1 border-t border-border">
                      <span>Total</span>
                      <span className="flex gap-4">
                        <span>{totalMB.toFixed(1)} MB</span>
                        <span>{totalCPU.toFixed(1)}%</span>
                      </span>
                    </div>
                  </div>
                </div>
              } align="end">
                <div className="h-full px-2 flex items-center gap-1.5 text-comment select-none cursor-default">
                  <span className="font-mono text-xs">{memStats.heap.toFixed(0)}M</span>
                  <span className="font-mono text-xs opacity-50">·</span>
                  <span className="font-mono text-xs">{totalCPU.toFixed(0)}%</span>
                </div>
              </Tip>
              {settings?.developer?.system_log && (
                <Tip label="System Log" align="end">
                  <button
                    onClick={() => {
                      const existing = mainPanelData?.tabs?.find((t: any) => t.type === 'logs');
                      if (existing) {
                        activateTab({ panelId: 'main', tabId: existing.id });
                      } else {
                        addPanelTab({ panelId: 'main', tab: { id: crypto.randomUUID(), type: 'logs', title: 'System Log', source: null } });
                      }
                    }}
                    className="h-full px-2 hover:bg-active text-comment transition-colors"
                  >
                    <Logs size={13}/>
                  </button>
                </Tip>
              )}
              </>
            );
          })()}

          {/* App Version / Update Progress */}
          {updateProgress && (updateProgress.status === "downloading" || updateProgress.status === "installing" || updateProgress.status === "checking" || updateProgress.status === "ready") ? (
            <Tip label={<>
                {updateProgress.status === "checking" && <span>Checking for updates...</span>}
                {updateProgress.status === "downloading" && (
                  <div className="space-y-1">
                    <div>
                      <div className="text-[10px] text-text">Downloaded : <span className="text-active">{((updateProgress.transferred || 0) / 1024 / 1024).toFixed(1)} MB / {((updateProgress.total || 0) / 1024 / 1024).toFixed(1)} MB</span></div>
                      <div className="text-[10px] text-text">Speed : <span className="text-active">{((updateProgress.bytesPerSecond || 0) / 1024 / 1024).toFixed(1)} MB/s</span></div>
                    </div>
                  </div>
                )}
                {updateProgress.status === "ready" && <span>Update downloaded and ready to install</span>}
                {updateProgress.status === "installing" && <span>Installing update...</span>}
              </>}>
              <div className="h-full px-3 flex items-center gap-2 text-comment select-none">
                <Download className="w-3 h-3 animate-pulse" style={{ color: 'var(--icon-primary)' }} />
                {updateProgress.status === "checking" && (
                  <span className="text-xs animate-pulse">Checking...</span>
                )}
                {updateProgress.status === "downloading" && (
                  <span className="text-xs animate-pulse">Downloading...</span>
                )}
                {updateProgress.status === "ready" && (
                  <span className="text-xs">Downloaded</span>
                )}
                {updateProgress.status === "installing" && (
                  <span className="text-xs animate-pulse">Installing...</span>
                )}
              </div>
            </Tip>
          ) : (
            <Tip label="Click to check for updates">
              <button
                onClick={handleCheckForUpdates}
                disabled={isCheckingUpdates}
                className={cn(
                  "h-full px-2 hover:bg-active text-comment select-none transition-opacity",
                  isCheckingUpdates ? "opacity-50 cursor-wait" : "cursor-pointer"
                )}
              >
                <span className="font-mono text-sm">
                  {isCheckingUpdates ? "Checking..." : `v${version}`}
                </span>
              </button>
            </Tip>
          )}

          {/* GitHub Link */}
          <Tip label="Visit GitHub" align="end">
            <a href="https://github.com/VoidenHQ/voiden" onClick={handleExternalLink("https://github.com/VoidenHQ/voiden")} className="h-full px-2 hover:bg-active text-comment flex items-center">
              <Github size={14} />
            </a>
          </Tip>

          {/* Discord Link */}
          <Tip label="Join Discord" align="end">
            <a href="https://discord.gg/XSYCf7JF4F" onClick={handleExternalLink("https://discord.gg/XSYCf7JF4F")} className="h-full px-2 hover:bg-active text-comment flex items-center">
              <MessageCircle size={14} />
            </a>
          </Tip>

          {/* Bottom Panel Toggle */}
          <Tip label={<span className="flex items-center gap-2"><span>Toggle terminal</span><Kbd keys={getShortcutLabel("ToggleTerminal")} size="sm" /></span>} align="end">
            <button
              className={cn(
                "h-full px-2 hover:bg-active text-comment",
                responsePanelPosition === "right"
                  ? !isBottomCollapsed && "bg-active"
                  : !isBottomCollapsed && bottomActiveView === "terminal" && "bg-active",
              )}
              onClick={() => {
                if (responsePanelPosition === "right") {
                  // Right mode: bottom panel is purely terminal — simple toggle with flag
                  setBottomOpenedByTerminal(isBottomCollapsed);
                  toggleBottom();
                  return;
                }

                // Bottom mode — close panel if terminal is currently active and visible
                if (!isBottomCollapsed && bottomActiveView === "terminal") {
                  setBottomOpenedByTerminal(false);
                  toggleBottom();
                  return;
                }

                // Open panel and switch to terminal view (panel may be closed or showing sidebar)
                setBottomOpenedByTerminal(true);
                setBottomActiveView("terminal");
                if (isBottomCollapsed) {
                  openBottomPanel();
                  bottomPanelRef?.current?.expand();
                }

                // Create or activate terminal tab — single source of truth, no race with handleToggleBottomPanel
                const tabs = bottomPanelData?.tabs ?? [];
                if (tabs.length === 0) {
                  newTerminalTab("bottom");
                } else {
                  const targetTabId = bottomPanelData?.activeTabId ?? tabs[0].id;
                  queryClient.setQueryData(["panel:tabs", "bottom"], (old: any) =>
                    old ? { ...old, activeTabId: targetTabId } : old
                  );
                  if (!bottomPanelData?.activeTabId) {
                    activateTab({ panelId: "bottom", tabId: targetTabId });
                  }
                }
              }}
            >
              <Terminal size={14} />
            </button>
          </Tip>

          {/* Response Panel — open/close in current position */}
          <Tip label={<span className="flex items-center gap-2"><span>Toggle response panel</span><Kbd keys={getShortcutLabel("ToggleResponsePanel")} size="sm" /></span>} align="end">
            <button
              className={cn(
                "h-full px-2 hover:bg-active text-comment",
                responsePanelPosition === "right" ? !isRightCollapsed && "bg-active" : !isBottomCollapsed && "bg-active",
              )}
              onClick={() => {
                if (responsePanelPosition === "right") {
                  toggleRight();
                } else {
                  toggleBottom();
                }
              }}
            >
              <PanelRight size={14} />
            </button>
          </Tip>
        </div>
      </div>

      {/* Branch Comparison Dialog */}
      <BranchComparisonDialog
        open={isCompareDialogOpen}
        onOpenChange={setIsCompareDialogOpen}
      />
    </div>
    </>
  );
};
