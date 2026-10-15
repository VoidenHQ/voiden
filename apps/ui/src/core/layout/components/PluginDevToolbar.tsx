import { useState, useRef, useCallback, useLayoutEffect, useEffect } from "react";
import ReactDOM from "react-dom";
import { GripHorizontal, Play, Square, Zap, RefreshCw, X, ChevronDown, ChevronUp, Loader2, Code2, PictureInPicture2, Pin, Copy, Trash2 } from "lucide-react";
import { useGetAppState } from "@/core/state/hooks";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { cn } from "@/core/lib/utils";
import { toast } from "@/core/components/ui/sonner";
import { useDevModeStore } from "@/core/layout/devModeStore";
import { Tip } from "@/core/components/ui/Tip";

type OpStatus = "idle" | "building" | "stopping" | "reloading" | "error";

type LogKind = "step" | "out" | "info" | "ok" | "error";
interface LogEntry { id: number; time: Date; kind: LogKind; text: string }

const MAX_LOG_LINES = 500;
const LOG_WIDTH = 380; // toolbar widens to this while details are shown

// Friendly label for a build command, shown as the current status.
const stepLabel = (cmd: string) =>
  cmd.startsWith("npm install") ? "Installing packages…" : cmd.startsWith("npm run build") ? "Building…" : cmd;

const LOG_KIND_CLASS: Record<LogKind, string> = {
  step: "text-text font-medium",
  out: "text-comment",
  info: "text-comment",
  ok: "text-green-400",
  error: "text-red-400",
};

const DOCK_GAP = 6; // px between the top-bar button and the docked toolbar
const EDGE = 8; // keep the docked toolbar this far from the window edge

// Where the top-bar plugin button is, so the docked toolbar can sit under it.
function useAnchorRect(enabled: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const measure = () => {
      const el = document.querySelector("[data-plugin-dev-anchor]");
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    // Plugins adding top-bar buttons shift the anchor without a window resize;
    // they also resize the button group it lives in, so watch that.
    const group = document.querySelector("[data-plugin-dev-anchor]")?.parentElement;
    const observer = group ? new ResizeObserver(measure) : null;
    if (group) observer!.observe(group);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [enabled]);
  return rect;
}

function StatusDot({ status, isInstalled }: { status: OpStatus; isInstalled: boolean }) {
  if (status === "building" || status === "reloading" || status === "stopping") {
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
  const { setDevMode, isToolbarDocked: docked, setToolbarDocked, isLiveReload: liveReload, setLiveReload } = useDevModeStore();

  const [pos, setPos] = useState(() => ({
    x: window.innerWidth - 240 - 16,
    y: window.innerHeight - 130 - 40,
  }));
  const [size, setSize] = useState({ w: 240 });
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [status, setStatus] = useState<OpStatus>("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [currentStep, setCurrentStep] = useState("");
  const [pluginId, setPluginId] = useState<string>();
  const pluginIdRef = useRef<string>();
  pluginIdRef.current = pluginId;
  const logSeq = useRef(0);
  const logListRef = useRef<HTMLDivElement>(null);
  const width = showLogs ? Math.max(size.w, LOG_WIDTH) : size.w;

  const log = useCallback((kind: LogKind, text: string) => {
    setLogs((prev) => [...prev, { id: ++logSeq.current, time: new Date(), kind, text }].slice(-MAX_LOG_LINES));
  }, []);

  useEffect(() => {
    window.electron?.pluginDev?.checkProject?.(sourcePath).then((r) => setPluginId(r?.pluginId));
  }, [sourcePath]);

  // The loader reports when this plugin actually loads, fails or unloads in the renderer.
  useEffect(() => {
    if (!pluginId) return;
    const onLifecycle = (e: Event) => {
      const { id, status, ms, error } = (e as CustomEvent).detail ?? {};
      if (id !== pluginId) return;
      if (status === "loaded") log("ok", `Loaded in Voiden${ms ? ` (${ms} ms)` : ""}`);
      else if (status === "unloaded") log("info", "Unloaded from Voiden");
      else if (status === "failed") {
        log("error", `Failed to load: ${error ?? "unknown error"}`);
        setShowLogs(true);
      }
    };
    window.addEventListener("voiden:pluginLifecycle", onLifecycle);
    return () => window.removeEventListener("voiden:pluginLifecycle", onLifecycle);
  }, [pluginId, log]);

  // Keep the newest line in view.
  useEffect(() => {
    if (showLogs && logListRef.current) logListRef.current.scrollTop = logListRef.current.scrollHeight;
  }, [logs, showLogs]);

  const anchor = useAnchorRect(docked);
  // Docked: right-aligned under the button, clamped inside the window.
  const dockedPos = {
    x: anchor
      ? Math.max(EDGE, Math.min(window.innerWidth - width - EDGE, anchor.right - width))
      : window.innerWidth - width - EDGE,
    y: anchor ? anchor.bottom + DOCK_GAP : 40,
  };
  const shownPos = docked ? dockedPos : pos;
  // Docked caret points at the middle of the button.
  const caretLeft = anchor ? Math.max(10, Math.min(width - 20, anchor.left + anchor.width / 2 - dockedPos.x - 5)) : width - 20;

  // Detaching starts the floating toolbar where the docked one was, so it doesn't jump.
  const detach = () => {
    setPos(dockedPos);
    setToolbarDocked(false);
  };

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
    if (docked) return;
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
  }, [pos, size.w, docked]);

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
    log("info", `Building ${pluginName} from ${sourcePath}`);
    const unsub = window.electron?.pluginDev?.onBuildOutput?.((line, kind) => {
      if (kind === "step") {
        setCurrentStep(stepLabel(line));
        log("step", `$ ${line}`);
      } else {
        log(kind === "info" ? "info" : "out", line);
      }
    });
    const fail = (message: string) => {
      log("error", message);
      setShowLogs(true);
      toast.error(message, { description: "See the plugin toolbar's details for the full log." });
      return false;
    };
    try {
      const buildResult = await window.electron?.pluginDev?.build?.(sourcePath);
      unsub?.();
      if (!buildResult?.success) return fail(buildResult?.error ?? "Build failed");
      log("ok", "Build finished");

      setCurrentStep("Loading into Voiden…");
      log("step", "Loading into Voiden");
      const loadResult = await (window as any).electron?.extensions?.devInstallFromPath?.(sourcePath);
      if (!loadResult?.success) return fail(loadResult?.error ?? "Load failed");
      const ext = loadResult.extension;
      if (ext?.id) setPluginId(ext.id);
      log("ok", `Installed ${ext?.id ?? pluginName}${ext?.version ? ` v${ext.version}` : ""}`);
      return true;
    } catch (e: any) {
      unsub?.();
      return fail(String(e?.message ?? e));
    } finally {
      setCurrentStep("");
    }
  };

  // Uninstall the currently installed dev extension
  const uninstallCurrent = async (ext: any) => {
    setCurrentStep("Unloading…");
    log("step", `Unloading ${ext.id}`);
    try {
      await (window as any).electron?.extensions?.uninstall?.(ext.id);
      log("ok", "Removed from Voiden");
      return true;
    } catch (e: any) {
      log("error", `Uninstall failed: ${e?.message ?? e}`);
      setShowLogs(true);
      toast.error(`Uninstall failed: ${e}`);
      return false;
    } finally {
      setCurrentStep("");
    }
  };

  // Request a plugin reload and resolve true once the loader reports this plugin
  // loaded (or failed — that's still a completed reload), false after a timeout.
  const reloadAndConfirm = (timeoutMs = 10000) =>
    new Promise<boolean>((resolve) => {
      const onLifecycle = (e: Event) => {
        const { id, status } = (e as CustomEvent).detail ?? {};
        if (id !== pluginIdRef.current || status === "unloaded") return;
        cleanup();
        resolve(true);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener("voiden:pluginLifecycle", onLifecycle);
      };
      window.addEventListener("voiden:pluginLifecycle", onLifecycle);
      window.dispatchEvent(new Event("voiden:reloadPlugins"));
    });

  // One build at a time. Changes that arrive mid-build queue a single follow-up build.
  const busyRef = useRef(false);
  const rebuildQueued = useRef(false);
  const isInstalledRef = useRef(isInstalled);
  isInstalledRef.current = isInstalled;

  // Build, install and load. On a running plugin this hot-swaps it: the app only
  // reloads plugins when the installed set changes, and reinstalling the same id
  // doesn't change it, so ask for one reload instead of uninstalling first.
  const runBuild = async (reason?: string) => {
    if (busyRef.current) {
      rebuildQueued.current = true;
      return;
    }
    busyRef.current = true;
    const wasRunning = isInstalledRef.current;
    setStatus(wasRunning ? "reloading" : "building");
    if (reason) log("info", reason);
    const ok = await buildAndInstall();
    if (ok) {
      queryClient.invalidateQueries({ queryKey: ["extensions"] });
      if (wasRunning) {
        // Ask for a reload and wait for the loader to confirm this plugin came back.
        // If it doesn't (e.g. the request got lost), ask once more.
        const confirmed = await reloadAndConfirm();
        if (!confirmed) {
          log("info", "No reload confirmation, retrying");
          if (!(await reloadAndConfirm())) log("error", "Voiden didn't reload the plugin. Try Stop, then Run.");
        }
      }
    }
    setStatus(ok ? "idle" : "error");
    busyRef.current = false;
    if (rebuildQueued.current) {
      rebuildQueued.current = false;
      runBuild("More changes came in during the build, rebuilding");
    }
  };
  const runBuildRef = useRef(runBuild);
  runBuildRef.current = runBuild;

  const handleRun = () => runBuild();
  const handleRebuild = () => runBuild("Rebuilding");

  // Stop: uninstall the plugin from Voiden (its source is untouched).
  const handleStop = async () => {
    if (!installedDev) return;
    rebuildQueued.current = false;
    setStatus("stopping");
    const ok = await uninstallCurrent(installedDev);
    setStatus(ok ? "idle" : "error");
    queryClient.invalidateQueries({ queryKey: ["extensions"] });
  };

  // Live reload: while the plugin is running, rebuild whenever its source changes.
  useEffect(() => {
    if (!liveReload || !isInstalled) return;
    const api = window.electron?.pluginDev;
    api?.watch?.(sourcePath).then((r) => {
      if (!r?.success) log("error", `Live reload unavailable: ${r?.error ?? "unknown error"}`);
      else log("info", "Live reload on: watching for changes");
    });
    const off = api?.onSourceChanged?.((files) => {
      const shown = files.slice(0, 3).join(", ") + (files.length > 3 ? ` +${files.length - 3} more` : "");
      runBuildRef.current(`Changed: ${shown}`);
    });
    return () => {
      off?.();
      api?.unwatch?.();
    };
  }, [liveReload, isInstalled, sourcePath, log]);

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
      style={{ position: "fixed", left: shownPos.x, top: shownPos.y, width, zIndex: 9999 }}
      className={cn(
        "flex flex-col bg-bg border border-border rounded-lg select-none",
        docked ? "shadow-lg" : "shadow-2xl",
      )}
    >
      {docked && (
        <span
          aria-hidden
          className="absolute -top-[6px] w-[10px] h-[10px] rotate-45 bg-panel border-l border-t border-border"
          style={{ left: caretLeft }}
        />
      )}
      {/* Title bar */}
      <div
        onMouseDown={onDragDown}
        className={cn(
          "relative flex items-center gap-2 px-2.5 py-1.5 bg-panel border-b border-border rounded-t-lg",
          !docked && "cursor-grab active:cursor-grabbing",
        )}
      >
        {!docked && <GripHorizontal size={11} className="text-comment flex-shrink-0" />}
        <Code2 size={11} className="text-amber-400 flex-shrink-0" />
        <span className="text-xs font-mono text-text flex-1 truncate min-w-0">{pluginName}</span>
        <Tip label={docked ? "Detach: make it movable" : "Dock under the top bar"} side="bottom">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={docked ? detach : () => setToolbarDocked(true)}
            className="p-0.5 rounded text-comment hover:text-text hover:bg-active transition-colors flex-shrink-0"
          >
            {docked ? <PictureInPicture2 size={11} /> : <Pin size={11} />}
          </button>
        </Tip>
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

          {/* Run / Stop: install the plugin into Voiden, or uninstall it */}
          <Tip label={isInstalled ? "Stop: unload the plugin from Voiden" : "Run: build and load the plugin"} side="top">
            <button
              onClick={isInstalled ? handleStop : handleRun}
              disabled={isBusy}
              className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md border bg-panel border-border text-xs text-text hover:bg-active disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isBusy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : isInstalled ? (
                <Square size={11} className="fill-current" />
              ) : (
                <Play size={12} className="fill-current" />
              )}
              {status === "building" ? "Building…" : status === "reloading" ? "Reloading…" : status === "stopping" ? "Stopping…" : isInstalled ? "Stop" : "Run"}
            </button>
          </Tip>

          {/* Rebuild now (hot-swaps the running plugin) */}
          <Tip label="Rebuild and reload now" side="top">
            <button
              onClick={handleRebuild}
              disabled={isBusy || !isInstalled}
              className="w-7 h-7 flex items-center justify-center rounded-md border bg-panel border-border text-text hover:bg-active disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={12} className={status === "reloading" ? "animate-spin" : ""} />
            </button>
          </Tip>

          {/* Live reload toggle */}
          <Tip label={liveReload ? "Live reload on: rebuilds when you save" : "Live reload off"} side="top">
            <button
              onClick={() => setLiveReload(!liveReload)}
              aria-pressed={liveReload}
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded-md border transition-colors",
                liveReload ? "bg-accent/10 border-accent/30 text-accent" : "bg-panel border-border text-comment hover:text-text hover:bg-active",
              )}
            >
              <Zap size={12} className={liveReload ? "fill-current" : ""} />
            </button>
          </Tip>
        </div>
      )}

      {!collapsed && (
        <div className="px-2.5 pb-2 flex items-center gap-2 text-[11px]">
          <span className={cn("flex-1 min-w-0 truncate", status === "error" ? "text-red-400" : "text-comment")}>
            {currentStep ||
              (status === "error"
                ? "Something went wrong. Check the details."
                : isInstalled
                  ? liveReload
                    ? "Running · watching for changes"
                    : "Running · live reload off"
                  : "Stopped. Press Run to build and load it.")}
          </span>
          <button
            onClick={() => setShowLogs((v) => !v)}
            className="flex items-center gap-0.5 text-comment hover:text-text transition-colors flex-shrink-0"
          >
            {showLogs ? "Hide details" : "Show details"}
            {showLogs ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      )}

      {!collapsed && showLogs && (
        <div className="border-t border-border flex flex-col select-text">
          <div className="flex items-center gap-1 px-2.5 py-1 bg-panel">
            <span className="text-[10px] uppercase tracking-wide text-comment flex-1">Log</span>
            <Tip label="Copy log" side="top">
              <button
                onClick={() => {
                  const text = logs.map((l) => `[${l.time.toLocaleTimeString()}] ${l.text}`).join("\n");
                  navigator.clipboard.writeText(text).then(() => toast.success("Log copied"));
                }}
                disabled={logs.length === 0}
                className="p-0.5 rounded text-comment hover:text-text hover:bg-active disabled:opacity-40 transition-colors"
              >
                <Copy size={11} />
              </button>
            </Tip>
            <Tip label="Clear log" side="top">
              <button
                onClick={() => setLogs([])}
                disabled={logs.length === 0}
                className="p-0.5 rounded text-comment hover:text-text hover:bg-active disabled:opacity-40 transition-colors"
              >
                <Trash2 size={11} />
              </button>
            </Tip>
          </div>
          <div ref={logListRef} className="max-h-[220px] min-h-[64px] overflow-y-auto px-2.5 py-1.5 font-mono text-[10.5px] leading-[1.5]">
            {logs.length === 0 ? (
              <div className="text-comment py-3 text-center font-sans text-[11px]">
                Nothing yet. Press Run to build and load the plugin.
              </div>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <span className="text-comment opacity-60 flex-shrink-0">{l.time.toLocaleTimeString([], { hour12: false })}</span>
                  <span className={cn("whitespace-pre-wrap break-all", LOG_KIND_CLASS[l.kind])}>{l.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Resize handle (floating only: docked width stays put under the button) */}
      {!docked && <div
        onMouseDown={onResizeDown}
        className="absolute bottom-0 right-0 w-3 h-3 cursor-ew-resize opacity-30 hover:opacity-80"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "3px 3px",
          backgroundPosition: "bottom right",
          color: "var(--color-comment, #888)",
        }}
      />}
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
