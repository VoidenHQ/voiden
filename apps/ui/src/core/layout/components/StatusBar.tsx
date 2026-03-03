import { PanelLeft, Terminal, Github, MessageCircle, PanelRight, GitCompareArrows, Download } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { GitBranchesList } from "@/core/git/components/GitBranchesList";
import { BranchComparisonDialog } from "@/core/git/components/BranchComparisonDialog";
import { useSettings } from "@/core/settings/hooks/useSettings";
import { useState, useEffect } from "react";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";

const handleExternalLink = (url: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  window.electron?.openExternal?.(url);
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
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [isCompareDialogOpen, setIsCompareDialogOpen] = useState(false);
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
      </div>

      {/* Right Status Items */}
      <div className="flex items-center space-x-2 h-full">
        <div className="flex h-full justify-between">
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
                  "h-full pt-1 px-2 hover:bg-active text-comment select-none transition-opacity",
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
            <a href="https://github.com/VoidenHQ/voiden" onClick={handleExternalLink("https://github.com/VoidenHQ/voiden")} className="h-full pt-2 px-2 hover:bg-active text-comment flex items-center">
              <Github size={14} />
            </a>
          </Tip>

          {/* Discord Link */}
          <Tip label="Join Discord" align="end">
            <a href="https://discord.gg/XSYCf7JF4F" onClick={handleExternalLink("https://discord.gg/XSYCf7JF4F")} className="h-full pt-2 px-2 hover:bg-active text-comment flex items-center">
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
