import { PanelLeft, Terminal, Github, MessageCircle, PanelRight, GitCompareArrows, Download, icons } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { GitBranchesList } from "@/core/git/components/GitBranchesList";
import { BranchComparisonDialog } from "@/core/git/components/BranchComparisonDialog";
import { useSettings } from "@/core/settings/hooks/useSettings";
import { useState, useEffect } from "react";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";
import { usePluginStore } from "@/plugins";
import type { StatusBarItem } from "@voiden/sdk/ui";

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
  const statusBarItems = usePluginStore((state) => state.statusBarItems);
  const leftItems = statusBarItems.filter((item) => item.position === 'left');
  const rightItems = statusBarItems.filter((item) => item.position === 'right');
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [isCompareDialogOpen, setIsCompareDialogOpen] = useState(false);
  const [memStats, setMemStats] = useState<{ heap: number; processes: { type: string; mb: number; cpu: number }[] } | null>(null);
  const [updateProgress, setUpdateProgress] = useState<{ percent?: number; bytesPerSecond?: number; transferred?: number; total?: number; status: string } | null>(null);
  const isMac = navigator?.userAgent?.toLowerCase().includes("mac") ?? false;

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

      const modKey = isMac ? event.metaKey : event.ctrlKey;

      if (event.code === "KeyD" && modKey && event.altKey) {
        event.preventDefault();
        setIsCompareDialogOpen((open) => !open);
        return;
      }
      if (target?.closest('.cm-editor, .txt-editor')) {
        return;
      }

      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;

      const hasOtherModifiers =
        (isMac && event.ctrlKey) || // Ctrl on Mac
        (!isMac && event.metaKey) || // Cmd on Windows/Linux
        event.altKey ||
        event.shiftKey;

      if (modifierPressed && !hasOtherModifiers && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        event.stopPropagation();
        toggleLeft();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [isMac]);

  return (
    <div className="h-8 flex-none border-t border-border flex items-center justify-between bg-panel">
      {/* Left Status Items */}
      <div className="flex items-center h-full">
        <Tip label={<span className="flex items-center gap-2"><span>Toggle left panel</span><Kbd keys={'⌘B'} size="sm" /></span>}>
          <button className={cn("h-full px-2 hover:bg-active text-comment", !isLeftCollapsed && "bg-active")} onClick={toggleLeft}>
            <PanelLeft size={14} />
          </button>
        </Tip>

        <GitBranchesList />

        <Tip label={<span className="flex items-center gap-2"><span>Compare branches</span><Kbd keys={'⌥⌘D'} size="sm" /></span>}>
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

          {/* Memory / CPU */}
          {memStats && (() => {
            const totalMB = memStats.processes.reduce((s, p) => s + p.mb, 0);
            const totalCPU = memStats.processes.reduce((s, p) => s + p.cpu, 0);
            return (
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
          <Tip label={<span className="flex items-center gap-2"><span>Toggle bottom panel</span><Kbd keys={'⌘J'} size="sm" /></span>} align="end">
            <button className={cn("h-full px-2 hover:bg-active text-comment", !isBottomCollapsed && "bg-active")} onClick={toggleBottom}>
              <Terminal size={14} />
            </button>
          </Tip>

          {/* Right Panel Toggle */}
          <Tip label={<span className="flex items-center gap-2"><span>Toggle right panel</span><Kbd keys={'⌘Y'} size="sm" /></span>} align="end">
            <button className={cn("h-full px-2 hover:bg-active text-comment", !isRightCollapsed && "bg-active")} onClick={toggleRight}>
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
  );
};
