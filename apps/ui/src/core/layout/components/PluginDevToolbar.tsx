import { useState, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { GripHorizontal, Play, Pause, RefreshCw, X, ChevronDown, ChevronUp, Loader2, Code2 } from "lucide-react";
import { useGetAppState } from "@/core/state/hooks";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { cn } from "@/core/lib/utils";
import { toast } from "@/core/components/ui/sonner";
import { useDevModeStore } from "@/core/layout/devModeStore";
import { Tip } from "@/core/components/ui/Tip";

type OpStatus = "idle" | "building" | "pausing" | "reloading" | "error";

function StatusDot({ status, isInstalled }: { status: OpStatus; isInstalled: boolean }) {
  if (status === "building" || status === "reloading" || status === "pausing") {
    return <Loader2 size={11} className="animate-spin text-comment flex-shrink-0" />;
  }
  if (status === "error") {
    return <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />;
  }
  if (isInstalled) {
    return (
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
      </span>
    );
  }
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-40" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
    </span>
  );
}

function FloatingPluginDev({ sourcePath, pluginName }: { sourcePath: string; pluginName: string }) {
  const queryClient = useQueryClient();
  const { setDevMode } = useDevModeStore();

  const [pos, setPos] = useState(() => ({
    x: window.innerWidth - 240 - 16,
    y: window.innerHeight - 130 - 40,
  }));
  const [size, setSize] = useState({ w: 240 });
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [status, setStatus] = useState<OpStatus>("idle");

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const resizing = useRef(false);
  const resizeStart = useRef({ mx: 0, w: 0 });

  // Live subscription to extensions — re-renders when install/uninstall happens
  const { data: extensions } = useQuery({
    queryKey: ["extensions"],
    queryFn: async () => (await (window as any).electron?.extensions?.getAll?.()) ?? [],
    staleTime: Infinity, // only refetch on explicit invalidation
  });

  const installedDev = (extensions as any[])?.find(
    (e: any) => e.isDev && e.devSourcePath === sourcePath && e.installedPath
  );
  const isInstalled = !!installedDev;

  const onDragDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const el = containerRef.current;
      const w = el?.offsetWidth ?? size.w;
      const h = el?.offsetHeight ?? 80;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - w, dragStart.current.px + ev.clientX - dragStart.current.mx)),
        y: Math.max(0, Math.min(window.innerHeight - h, dragStart.current.py + ev.clientY - dragStart.current.my)),
      });
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos, size.w]);

  const onResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    resizeStart.current = { mx: e.clientX, w: size.w };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const newW = Math.min(360, Math.max(180, resizeStart.current.w + ev.clientX - resizeStart.current.mx));
      setSize({ w: newW });
      setPos((p) => ({ x: Math.min(p.x, window.innerWidth - newW), y: p.y }));
    };
    const onUp = () => { resizing.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [size]);

  // Build + install from source
  const buildAndInstall = async () => {
    const outputBuffer: string[] = [];
    const unsub = (window as any).electron?.pluginDev?.onBuildOutput?.((line: string) => { outputBuffer.push(line); });
    try {
      const buildResult = await (window as any).electron?.pluginDev?.build?.(sourcePath);
      unsub?.();
      if (!buildResult?.success) {
        const tail = outputBuffer.slice(-6).join("\n").trim();
        toast.error(buildResult?.error ?? "Build failed", tail ? { description: tail } : undefined);
        return false;
      }
      const loadResult = await (window as any).electron?.extensions?.devInstallFromPath?.(sourcePath);
      if (!loadResult?.success) {
        toast.error(loadResult?.error ?? "Load failed");
        return false;
      }
      return true;
    } catch (e: any) {
      unsub?.();
      toast.error(String(e));
      return false;
    }
  };

  // Uninstall the currently installed dev extension
  const uninstallCurrent = async (ext: any) => {
    try {
      await (window as any).electron?.extensions?.uninstall?.(ext.id);
      return true;
    } catch (e: any) {
      toast.error(`Uninstall failed: ${e}`);
      return false;
    }
  };

  const handlePlay = async () => {
    setStatus("building");
    const ok = await buildAndInstall();
    setStatus(ok ? "idle" : "error");
    if (!ok) setTimeout(() => setStatus("idle"), 3000);
    queryClient.invalidateQueries({ queryKey: ["extensions"] });
  };

  const handlePause = async () => {
    if (!installedDev) return;
    setStatus("pausing");
    const ok = await uninstallCurrent(installedDev);
    setStatus(ok ? "idle" : "error");
    if (!ok) setTimeout(() => setStatus("idle"), 3000);
    queryClient.invalidateQueries({ queryKey: ["extensions"] });
  };

  const handleReload = async () => {
    setStatus("reloading");
    // Uninstall first if already installed
    if (installedDev) {
      const uninstallOk = await uninstallCurrent(installedDev);
      if (!uninstallOk) { setStatus("error"); setTimeout(() => setStatus("idle"), 3000); return; }
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
    }
    // Fresh build + install
    const ok = await buildAndInstall();
    setStatus(ok ? "idle" : "error");
    if (!ok) setTimeout(() => setStatus("idle"), 3000);
    queryClient.invalidateQueries({ queryKey: ["extensions"] });
  };

  const isBusy = status !== "idle" && status !== "error";
  const close = () => { setVisible(false); setDevMode(false); };

  if (!visible) {
    return ReactDOM.createPortal(
      <button
        style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999 }}
        onMouseDown={onDragDown}
        onClick={(e) => { if (!dragging.current) { e.stopPropagation(); setVisible(true); } }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-panel border border-border rounded-full shadow-lg text-xs text-comment hover:text-text hover:bg-active transition-colors cursor-grab active:cursor-grabbing select-none"
      >
        <Code2 size={12} className="text-amber-400" />
        <span className="font-mono text-[11px]">{pluginName}</span>
      </button>,
      document.body
    );
  }

  return ReactDOM.createPortal(
    <div
      ref={containerRef}
      style={{ position: "fixed", left: pos.x, top: pos.y, width: size.w, zIndex: 9999 }}
      className="flex flex-col bg-bg border border-border rounded-lg shadow-2xl overflow-hidden select-none"
    >
      {/* Title bar */}
      <div
        onMouseDown={onDragDown}
        className="flex items-center gap-2 px-2.5 py-1.5 bg-panel border-b border-border cursor-grab active:cursor-grabbing"
      >
        <GripHorizontal size={11} className="text-comment flex-shrink-0" />
        <Code2 size={11} className="text-amber-400 flex-shrink-0" />
        <span className="text-xs font-mono text-text flex-1 truncate min-w-0">{pluginName}</span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setCollapsed((c) => !c)}
          className="p-0.5 rounded text-comment hover:text-text hover:bg-active transition-colors flex-shrink-0"
        >
          {collapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
        </button>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={close}
          className="p-0.5 rounded text-comment hover:text-text hover:bg-active transition-colors flex-shrink-0"
        >
          <X size={11} />
        </button>
      </div>

      {!collapsed && (
        <div className="px-2.5 py-2 flex items-center gap-2">
          <StatusDot status={status} isInstalled={isInstalled} />

          {/* Play / Pause toggle */}
          <Tip
            label={isInstalled ? "Pause: unload plugin" : "Play: build & load plugin"}
            side="top"
          >
            <button
              onClick={isInstalled ? handlePause : handlePlay}
              disabled={isBusy}
              className={cn(
                "flex-1 flex items-center justify-center h-7 rounded-md border transition-colors",
                "bg-panel border-border text-text hover:bg-active disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {status === "building" || status === "pausing"
                ? <Loader2 size={13} className="animate-spin" />
                : isInstalled
                ? <Pause size={13} className="fill-current" />
                : <Play size={13} className="fill-current" />}
            </button>
          </Tip>

          {/* Reload */}
          <Tip label="Reload: uninstall then rebuild & reinstall fresh" side="top">
            <button
              onClick={handleReload}
              disabled={isBusy}
              className={cn(
                "flex-1 flex items-center justify-center h-7 rounded-md border transition-colors",
                "bg-panel border-border text-text hover:bg-active disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              <RefreshCw size={13} className={status === "reloading" ? "animate-spin" : ""} />
            </button>
          </Tip>
        </div>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={onResizeDown}
        className="absolute bottom-0 right-0 w-3 h-3 cursor-ew-resize opacity-30 hover:opacity-80"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "3px 3px",
          backgroundPosition: "bottom right",
          color: "var(--color-comment, #888)",
        }}
      />
    </div>,
    document.body
  );
}

export const PluginDevToolbar = () => {
  const { isDevMode } = useDevModeStore();
  const { data: appState } = useGetAppState();
  const sourcePath = (appState as any)?.activeDirectory as string | undefined;
  const pluginName = sourcePath?.replace(/\\/g, "/").split("/").pop() ?? "plugin";

  if (!isDevMode || !sourcePath) return null;
  return <FloatingPluginDev sourcePath={sourcePath} pluginName={pluginName} />;
};
