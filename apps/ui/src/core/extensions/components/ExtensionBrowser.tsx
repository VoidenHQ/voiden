import { Search, Settings, Loader2, Users, Upload, MoreVertical, RefreshCw, Trash2, Cpu, Globe, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  useGetExtensions,
  useInstallExtension,
  useInstallExtensionFromZip,
  useUninstallExtension,
  useSetExtensionEnabled,
  useOpenExtensionDetails,
  useUpdateExtension,
} from "@/core/extensions/hooks";
import { useQueryClient } from "@tanstack/react-query";
import type { Extension } from "@/types";
import { cn } from "@/core/lib/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { usePluginStore } from "@/plugins";
import { toast } from "@/core/components/ui/sonner";
import { Tip } from "@/core/components/ui/Tip";
import logo from "@/assets/logo-dark.png";

// Module-level timestamp — survives component unmount/remount.
// Stores when the registry was last fetched so the refresh button can reset it.
let _lastRegistryFetch = 0;

const ExtensionIcon = ({ extension, size = "md" }: { extension: Extension; size?: "sm" | "md" }) => {
  const dim = size === "sm" ? "w-8 h-8" : "w-10 h-10";
  const imgDim = size === "sm" ? "w-5 h-5" : "w-7 h-7";

  if (extension.logo) {
    return (
      <div className={`${dim} rounded-lg bg-active/30 flex items-center justify-center overflow-hidden border border-border shadow-inner flex-shrink-0`}>
        <img src={extension.logo} className="w-full h-full object-cover" alt={extension.name} />
      </div>
    );
  }

  if (extension.type === "core") {
    return (
      <div className={`${dim} rounded-lg bg-active/30 flex items-center justify-center overflow-hidden border border-border shadow-inner flex-shrink-0`}>
        <img src={logo} className={`${imgDim} object-contain`} alt="Voiden" />
      </div>
    );
  }

  return (
    <div className={`${dim} rounded-lg bg-active/30 flex items-center justify-center border border-border shadow-inner flex-shrink-0`}>
      <Users size={size === "sm" ? 16 : 20} className="text-comment" />
    </div>
  );
};

const ExtensionItem = ({ extension }: { extension: Extension }) => {
  const installMutation = useInstallExtension();
  const uninstallMutation = useUninstallExtension();
  const toggleEnabledMutation = useSetExtensionEnabled();
  const openExtensionDetailsMutation = useOpenExtensionDetails();
  const updateMutation = useUpdateExtension();
  const { pluginErrors, coreUpdateInfo, installingCorePlugins, setInstallingPlugin, setCoreUpdateInfo } = usePluginStore();

  const error = pluginErrors.find((err) => err.extensionId === extension.id);
  const updateInfo = extension.type === "core" ? coreUpdateInfo?.[extension.id] : undefined;
  const hasCompatibleUpdate = updateInfo?.hasUpdate && updateInfo?.compatible;
  const hasIncompatibleUpdate = updateInfo?.hasUpdate && !updateInfo?.compatible;

  const typeLabel = extension.type === "core" ? "Core" : "Community";

  const typeBadgeClass =
    extension.type === "core"
      ? "bg-purple-500/10 text-purple-300 border-purple-500/20"
      : "bg-orange-500/10 text-orange-300 border-orange-500/20";

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUninstallingCore, setIsUninstallingCore] = useState(false);

  const coreIsLocallyAvailable = extension.type !== "core" || extension.isLocallyAvailable !== false;
  const displayVersion = (window as any).__voiden_ota_manifests__?.[extension.id]?.version ?? extension.version;

  const handleToggleEnabled = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleEnabledMutation.mutate({ extensionId: extension.id, enabled: !extension.enabled });
  };

  const handleInstallCore = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const coreExtApi = (window as any).electron?.coreExtensions;
    setInstallingPlugin(extension.id, true);
    try {
      const result = await coreExtApi?.checkAndUpdate?.(extension.id);
      if (result?.updated?.length > 0) {
        await toggleEnabledMutation.mutateAsync({ extensionId: extension.id, enabled: true });
        setInstallingPlugin(extension.id, false);
        toast.success(`${extension.name} installed.`);
      } else if (result?.error) {
        setInstallingPlugin(extension.id, false);
        toast.error(`Could not install ${extension.name}: ${result.error}`);
      } else {
        setInstallingPlugin(extension.id, false);
        toast.error(`Could not download ${extension.name}. Check your connection.`);
      }
    } catch {
      setInstallingPlugin(extension.id, false);
      toast.error(`Install failed unexpectedly.`);
    }
  };

  const handleCheckForUpdate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCheckingUpdate(true);
    try {
      const coreExtApi = (window as any).electron?.coreExtensions;
      if (!coreExtApi?.checkForUpdates) return;
      const result = await coreExtApi.checkForUpdates();
      if (result?.error) { toast.error(`Update check failed: ${result.error}`); return; }
      if (result?.plugins?.length) setCoreUpdateInfo(result.plugins);
      const thisPlugin = result?.plugins?.find((p: any) => p.pluginId === extension.id);
      if (thisPlugin?.hasUpdate && thisPlugin?.compatible) {
        toast.info(`Update available: v${thisPlugin.remoteVersion}`);
      } else if (thisPlugin?.hasUpdate && !thisPlugin?.compatible) {
        toast.warning(`v${thisPlugin.remoteVersion} requires Voiden ${thisPlugin.requiredAppVersion}`);
      } else {
        toast.success(`${extension.name} is up to date.`);
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleUpdateCore = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const coreExtApi = (window as any).electron?.coreExtensions;
    setIsUpdating(true);
    try {
      const result = await coreExtApi?.checkAndUpdate?.(extension.id);
      if (result?.updated?.length > 0) {
        toast.success(`${extension.name} updated. Restarting...`, { duration: 2000 });
        setTimeout(() => coreExtApi?.restart?.(), 1500);
      } else if (result?.error) {
        setIsUpdating(false);
        toast.error(`Update failed: ${result.error}`);
      } else {
        setIsUpdating(false);
        toast.error(`Could not download update. Check your connection.`);
      }
    } catch {
      setIsUpdating(false);
      toast.error(`Update failed unexpectedly.`);
    }
  };

  const handleUninstallCore = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsUninstallingCore(true);
    try {
      const coreExtApi = (window as any).electron?.coreExtensions;
      await coreExtApi?.deleteCache?.(extension.id);
      await toggleEnabledMutation.mutateAsync({ extensionId: extension.id, enabled: false });
      toast.success(`${extension.name} removed. Click Install to re-download.`);
    } catch {
      toast.error("Failed to uninstall plugin.");
    } finally {
      setIsUninstallingCore(false);
    }
  };

  const renderContextMenu = () => (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild onClick={(e) => e.stopPropagation()}>
        <button className="w-6 h-6 hover:bg-active flex justify-center items-center outline-none rounded transition-colors border border-transparent hover:border-border">
          <Settings size={14} className="text-comment hover:text-text transition-colors" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right" align="start" sideOffset={12}
          className="bg-editor z-[9999] outline-none min-w-[160px] border border-border rounded-md shadow-lg p-1"
        >
          {/* Enable/Disable — only for installed plugins */}
          {((extension.type === "community" && extension.installedPath) ||
            (extension.type === "core" && coreIsLocallyAvailable)) && (
            <DropdownMenu.Item
              onClick={handleToggleEnabled}
              className="w-full px-3 py-2 text-xs text-left text-text hover:bg-active outline-none cursor-pointer rounded-sm"
            >
              {extension.enabled ? "Disable" : "Enable"}
            </DropdownMenu.Item>
          )}

          {/* Check for Update — core installed only */}
          {extension.type === "core" && coreIsLocallyAvailable && (
            <DropdownMenu.Item
              onClick={handleCheckForUpdate}
              disabled={isCheckingUpdate}
              className="w-full px-3 py-2 text-xs text-left text-text hover:bg-active outline-none cursor-pointer rounded-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={12} className={isCheckingUpdate ? "animate-spin" : ""} />
              {isCheckingUpdate ? "Checking..." : "Check for Update"}
            </DropdownMenu.Item>
          )}

          {/* Uninstall core — only if installed */}
          {extension.type === "core" && coreIsLocallyAvailable && (
            <>
              <DropdownMenu.Separator className="my-1 border-t border-border" />
              <DropdownMenu.Item
                onClick={handleUninstallCore}
                disabled={isUninstallingCore}
                className="w-full px-3 py-2 text-xs text-left hover:bg-active outline-none cursor-pointer text-red-400 hover:text-red-300 rounded-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUninstallingCore ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Uninstall
              </DropdownMenu.Item>
            </>
          )}

          {/* Uninstall community — only if installed */}
          {extension.type === "community" && extension.installedPath && (
            <>
              <DropdownMenu.Separator className="my-1 border-t border-border" />
              <DropdownMenu.Item
                onClick={(e) => { e.stopPropagation(); uninstallMutation.mutate(extension.id); }}
                className="w-full px-3 py-2 text-xs text-left hover:bg-active outline-none cursor-pointer text-red-400 hover:text-red-300 rounded-sm flex items-center gap-2"
              >
                <Trash2 size={12} />
                Uninstall
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  const renderActions = () => {
    // Not installed — install button lives in the bottom row, nothing at top-right
    if (extension.type === "core" && !coreIsLocallyAvailable) return null;
    if (extension.type === "community" && !extension.installedPath) return null;

    // Community: has update
    if (extension.type === "community" && extension.latestVersion) {
      return updateMutation.isPending ? (
        <button disabled className="px-2.5 py-1 bg-button-primary/40 text-bg/60 text-xs flex items-center gap-1 rounded-md cursor-not-allowed">
          <Loader2 size={11} className="animate-spin" /> Updating
        </button>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); updateMutation.mutate(extension.id); }}
          className="px-2.5 py-1 bg-button-primary hover:bg-button-primary-hover text-bg text-xs rounded-md font-medium transition-colors shadow-sm"
        >
          Update
        </button>
      );
    }

    // Core: compatible update available
    if (extension.type === "core" && coreIsLocallyAvailable && hasCompatibleUpdate) {
      return isUpdating ? (
        <button disabled className="px-2.5 py-1 bg-button-primary/40 text-bg/60 text-xs flex items-center gap-1 rounded-md cursor-not-allowed">
          <Loader2 size={11} className="animate-spin" /> Updating
        </button>
      ) : (
        <button
          onClick={handleUpdateCore}
          className="px-2.5 py-1 bg-button-primary hover:bg-button-primary-hover text-bg text-xs rounded-md font-medium transition-colors shadow-sm"
        >
          Update
        </button>
      );
    }

    return renderContextMenu();
  };

  return (
    <div
      className={cn(
        "group relative mx-2 my-2 rounded-xl border border-border bg-panel/80 hover:bg-panel cursor-pointer transition-colors shadow-sm hover:shadow-md min-h-[90px]",
        !extension.enabled && coreIsLocallyAvailable && "opacity-70"
      )}
      onClick={() => openExtensionDetailsMutation.mutate(extension)}
    >
      <div className="p-4 pr-14">
        <div className="flex items-start gap-4">
          <div className="mt-0.5">
            <ExtensionIcon extension={extension} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={cn("text-sm font-semibold truncate mt-0", extension.enabled ? "text-text" : "text-comment")}>
                {extension.name}
              </h3>
              <span className="text-xs text-comment flex-shrink-0">v{displayVersion}</span>
              <span className={cn("text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border", typeBadgeClass)}>
                {typeLabel}
              </span>
              {extension.latestVersion && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/20 text-blue-300 bg-blue-500/10">
                  Update available
                </span>
              )}
            </div>
            <p className="text-xs text-comment line-clamp-2 mt-1.5 leading-relaxed">{extension.description}</p>
            <div className="flex items-center gap-2 text-[11px] text-comment mt-2.5">
              <span className="opacity-60">by</span>
              <span className="font-medium text-button-primary/80 hover:text-button-primary transition-colors">{extension.author}</span>
              <div className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {extension.type === "core" && !coreIsLocallyAvailable && (
                  installingCorePlugins?.[extension.id] ? (
                    <button disabled className="px-2 py-0.5 text-[10px] bg-button-primary/40 text-bg/60 rounded flex items-center gap-1 cursor-not-allowed">
                      <Loader2 size={10} className="animate-spin" /> Installing
                    </button>
                  ) : (
                    <button
                      onClick={handleInstallCore}
                      className="px-2 py-0.5 text-[10px] bg-button-primary hover:bg-button-primary-hover text-bg rounded font-medium transition-colors"
                    >
                      Install
                    </button>
                  )
                )}
                {extension.type === "community" && !extension.installedPath && (
                  installMutation.isPending ? (
                    <button disabled className="px-2 py-0.5 text-[10px] bg-button-primary/40 text-bg/60 rounded flex items-center gap-1 cursor-not-allowed">
                      <Loader2 size={10} className="animate-spin" /> Installing
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); installMutation.mutate(extension.id); }}
                      className="px-2 py-0.5 text-[10px] bg-button-primary hover:bg-button-primary-hover text-bg rounded font-medium transition-colors"
                    >
                      Install
                    </button>
                  )
                )}
                {(extension.type === "community" ? !!extension.installedPath : coreIsLocallyAvailable) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-comment bg-active/20">
                    {extension.enabled ? "Enabled" : "Disabled"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions — top-right */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {error && (
          <Tip label={error.error} side="bottom" align="end">
            <button
              onClick={(e) => { e.stopPropagation(); toast.error(error.error); }}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Error
            </button>
          </Tip>
        )}
        {hasCompatibleUpdate && coreIsLocallyAvailable && (
          <Tip label={`Update available — v${updateInfo?.remoteVersion}`} side="bottom" align="end">
            <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0 cursor-default" />
          </Tip>
        )}
        {hasIncompatibleUpdate && coreIsLocallyAvailable && (
          <Tip label={`v${updateInfo?.remoteVersion} requires Voiden ${updateInfo?.requiredAppVersion}`} side="bottom" align="end">
            <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 cursor-default" />
          </Tip>
        )}
        {renderActions()}
      </div>

      {extension.enabled && coreIsLocallyAvailable && (
        <div className="absolute bottom-2 right-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
        </div>
      )}
    </div>
  );
};

const Blk = ({ d, cls }: { d: number; cls: string }) => (
  <div
    className={cn("rounded", cls)}
    style={{ animation: "block-assemble 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both", animationDelay: `${d}ms`, transformOrigin: "left center" }}
  />
);

const SkeletonCard = ({ base = 0 }: { base?: number }) => (
  <div
    className="mx-2 my-2 rounded-xl border border-border bg-panel/80 min-h-[90px] p-4 relative overflow-hidden"
    style={{ animation: "card-rise 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both", animationDelay: `${base}ms` }}
  >
    <div className="flex items-start gap-3">
      <Blk d={base + 40} cls="mt-0.5 w-10 h-10 rounded-lg bg-active/70 flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Blk d={base + 90}  cls="h-3 w-32 bg-active/70" />
          <Blk d={base + 120} cls="h-3 w-8 bg-active/40" />
          <Blk d={base + 150} cls="h-4 w-12 bg-active/30" />
        </div>
        <Blk d={base + 190} cls="h-2.5 w-full bg-active/50" />
        <Blk d={base + 230} cls="h-2.5 w-4/5 bg-active/40" />
        <div className="flex items-center gap-2 pt-0.5">
          <Blk d={base + 270} cls="h-2 w-6 bg-active/30" />
          <Blk d={base + 290} cls="h-2 w-20 bg-active/50" />
          <div className="ml-auto"><Blk d={base + 310} cls="h-4 w-14 bg-active/30" /></div>
        </div>
      </div>
    </div>
    <div
      className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent"
      style={{ animation: "shimmer 2.5s ease-in-out infinite", animationDelay: `${base + 420}ms` }}
    />
  </div>
);

const ExtensionBrowserSkeleton = () => (
  <div className="flex flex-col h-full">
    <div className="px-2 pt-2">
      <div className="flex items-center gap-2 h-9 px-3 bg-panel border border-border rounded-lg overflow-hidden" style={{ animation: "card-rise 0.35s ease-out both" }}>
        <Blk d={60} cls="w-3.5 h-3.5 rounded-full bg-active/50 flex-shrink-0" />
        <Blk d={100} cls="flex-1 h-3 bg-active/40" />
      </div>
    </div>
    <div className="px-4 py-2.5 flex items-center gap-2 text-xs text-comment/60" style={{ animation: "card-rise 0.35s ease-out both", animationDelay: "60ms" }}>
      <div className="flex gap-1 items-center">
        {[0, 160, 320].map((d, i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-button-primary/50 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
      </div>
      <span>Assembling plugins</span>
    </div>
    <div className="flex-1 overflow-hidden">
      {[0, 110, 220, 330, 440].map((base, i) => <SkeletonCard key={i} base={base} />)}
    </div>
  </div>
);

export const ExtensionBrowser = () => {
  const { data: extensions, isLoading } = useGetExtensions();
  const queryClient = useQueryClient();
  const installFromZip = useInstallExtensionFromZip();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "core" | "community">("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const doFetchRegistry = async () => {
    const coreExt = (window as any).electron?.coreExtensions;
    const extApi = (window as any).electron?.extensions;
    if (!coreExt?.fetchRegistry) return;
    setIsRefreshing(true);
    try {
      await coreExt.fetchRegistry();
      const updated = await extApi?.getAll?.();
      if (updated) queryClient.setQueryData(["extensions"], updated);
      _lastRegistryFetch = Date.now();
    } catch {
      // silently ignore — no network
    } finally {
      setIsRefreshing(false);
    }
  };

  // Auto-fetch once per session on first open
  useEffect(() => {
    if (_lastRegistryFetch > 0) return;
    doFetchRegistry();
  }, []);

  useEffect(() => {
    if (installFromZip.isError) {
      toast.error((installFromZip.error as Error)?.message || "Failed to install extension");
    }
  }, [installFromZip.isError, installFromZip.error]);

  if (isLoading) return <ExtensionBrowserSkeleton />;

  const filteredExtensions = useMemo(() => {
    let result = extensions || [];
    if (category !== "all") result = result.filter((ext: Extension) => ext.type === category);
    const query = search.trim().toLowerCase();
    if (!query) return result;
    return result.filter((ext: Extension) =>
      [ext.name, ext.description, ext.author, ext.id].filter(Boolean).join(" ").toLowerCase().includes(query)
    );
  }, [extensions, search, category]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 pt-2 flex flex-col gap-2">
        <div className="flex items-center gap-2 h-9 px-3 bg-panel border border-border rounded-lg">
          <Search size={14} className="text-comment" />
          <input
            placeholder="Search extensions..."
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-comment/70 truncate min-w-0"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            onClick={doFetchRegistry}
            disabled={isRefreshing}
            title="Refresh plugin registry"
            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-active transition-colors text-comment disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCw size={13} className={isRefreshing ? "animate-spin" : ""} />
          </button>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-active transition-colors text-comment" aria-label="Extension actions">
                <MoreVertical size={14} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content side="bottom" align="end" sideOffset={8} className="bg-editor z-[9999] outline-none min-w-[180px] border border-border rounded-md shadow-lg p-1">
                <DropdownMenu.Item
                  onClick={() => installFromZip.mutate()}
                  disabled={installFromZip.isPending}
                  className="w-full px-3 py-2 text-xs text-left text-text hover:bg-active outline-none cursor-pointer rounded-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {installFromZip.isPending ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {installFromZip.isPending ? "Installing..." : "Install from zip"}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <div className="flex p-0.5 bg-active/40 rounded-lg border border-border">
          {[
            { id: "all", label: "All", icon: Globe },
            { id: "core", label: "Core", icon: Cpu },
            { id: "community", label: "Community", icon: Users },
          ].map((tab) => (
            <Tip key={tab.id} label={tab.label} side="bottom">
              <button
                onClick={() => setCategory(tab.id as any)}
                className={cn(
                  "flex-1 flex items-center justify-center py-1.5 rounded-md transition-all",
                  category === tab.id ? "bg-panel text-button-primary shadow-sm border border-border" : "text-comment hover:text-text hover:bg-active/50 border border-transparent"
                )}
              >
                <tab.icon size={12} className={cn(category === tab.id ? "text-button-primary" : "text-comment/70")} />
              </button>
            </Tip>
          ))}
        </div>
      </div>

      <div className="border-border flex-1 flex flex-col mb-1.5 overflow-y-scroll scrollbar-hide">
        <div className="bg-bg h-full border-border mb-2">
          {filteredExtensions?.map((extension: Extension) => (
            <ExtensionItem key={extension.id} extension={extension} />
          ))}
          {!filteredExtensions?.length && (
            <div className="px-4 py-16 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-active/20 flex items-center justify-center mb-4">
                <Search size={20} className="text-comment/40" />
              </div>
              <p className="text-sm font-medium text-comment">No extensions found</p>
              <p className="text-xs text-comment/60 mt-1 max-w-[200px]">Try adjusting your search or category filter</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
