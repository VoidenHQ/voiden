import { Search, Settings, Loader2, Users, Upload, RefreshCw, Trash2, Cpu, Globe, RotateCw, HardDrive, ArrowUpCircle, ChevronDown, Check } from "lucide-react";
import * as LucideIcons from "lucide-react";
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

// Module-level timestamps — survive component unmount/remount.
let _lastRegistryFetch = 0;
let _lastUpdateCheck = 0;

const ExtensionIcon = ({ extension, size = "md" }: { extension: Extension; size?: "sm" | "md" | "lg" }) => {
  const dim = size === "sm" ? "w-8 h-8" : size === "lg" ? "w-14 h-14" : "w-10 h-10";
  const imgDim = size === "sm" ? "w-5 h-5" : size === "lg" ? "w-9 h-9" : "w-7 h-7";
  const iconSize = size === "sm" ? 16 : size === "lg" ? 28 : 20;

  if (extension.icon) {
    const icon = extension.icon;

    // URL or embedded base64 data URL → render as image
    if (icon.startsWith("http") || icon.startsWith("data:")) {
      return (
        <div className={`${dim} rounded-lg bg-active/30 flex items-center justify-center overflow-hidden border border-border shadow-inner flex-shrink-0`}>
          <img src={icon} className="w-full h-full object-cover" alt={extension.name} />
        </div>
      );
    }

    // Lucide icon name → resolve dynamically
    const LucideIcon = (LucideIcons as Record<string, any>)[icon] as React.ComponentType<{ size?: number; className?: string }> | undefined;
    if (LucideIcon) {
      return (
        <div className={`${dim} rounded-lg bg-active/30 flex items-center justify-center border border-border shadow-inner flex-shrink-0`}>
          <LucideIcon size={iconSize} className="text-foreground" />
        </div>
      );
    }
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
      <Users size={iconSize} className="text-comment" />
    </div>
  );
};

const ExtensionItem = ({ extension }: { extension: Extension }) => {
  const installMutation = useInstallExtension();
  const uninstallMutation = useUninstallExtension();
  const toggleEnabledMutation = useSetExtensionEnabled();
  const openExtensionDetailsMutation = useOpenExtensionDetails();
  const updateMutation = useUpdateExtension();
  const queryClient = useQueryClient();
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

  const { refetch: refetchExtensions } = useGetExtensions();
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isUninstallingCore, setIsUninstallingCore] = useState(false);
  const [isCheckingCommunityUpdate, setIsCheckingCommunityUpdate] = useState(false);

  const coreIsLocallyAvailable = extension.type !== "core" || extension.isLocallyAvailable !== false;
  const displayVersion = (window as any).__voiden_ota_manifests__?.[extension.id]?.version ?? extension.version;

  const handleToggleEnabled = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleEnabledMutation.mutate({ extensionId: extension.id, enabled: !extension.enabled });
  };

  const handleInstallCore = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const coreExtApi = (window as any).electron?.coreExtensions;
    const activateBundled = async () => {
      await (window as any).electron?.extensions.reinstallCore?.(extension.id);
      await queryClient.invalidateQueries({ queryKey: ["extensions"] });
    };
    setInstallingPlugin(extension.id, true);
    try {
      const result = await coreExtApi?.checkAndUpdate?.(extension.id);
      if (result?.updated?.length > 0) {
        await toggleEnabledMutation.mutateAsync({ extensionId: extension.id, enabled: true });
        setInstallingPlugin(extension.id, false);
        toast.success(`${extension.name} installed.`);
        return;
      }
      if (result?.incompatible?.includes(extension.id)) {
        await activateBundled();
        const details = result.incompatibleVersions?.[extension.id];
        if (details) {
          queryClient.setQueryData<any[]>(["extensions"], (old) =>
            old?.map((e: any) =>
              e.id === extension.id
                ? { ...e, incompatibleLatestVersion: details.version, requiredVoidenVersion: details.requiredVoidenVersion }
                : e
            ) ?? old
          );
        }
        setInstallingPlugin(extension.id, false);
        const fresh = queryClient.getQueryData<any[]>(["extensions"])?.find((e: any) => e.id === extension.id);
        if (fresh?.isLocallyAvailable) {
          toast.warning(`Latest version requires a newer Voiden. Enabled bundled version.`);
        } else {
          toast.error(`${extension.name} requires a newer Voiden. Update the app to install.`);
        }
        return;
      }
      if (result?.error) {
        await activateBundled();
        setInstallingPlugin(extension.id, false);
        const fresh = queryClient.getQueryData<any[]>(["extensions"])?.find((e: any) => e.id === extension.id);
        if (fresh?.isLocallyAvailable) {
          toast.warning(`Could not reach server. Enabled bundled version of ${extension.name}.`);
        } else {
          toast.error(`Could not download ${extension.name}. Check your connection.`);
        }
        return;
      }
      // upToDate — remote version matches bundled, activate the bundled copy.
      await activateBundled();
      setInstallingPlugin(extension.id, false);
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
      const result = await coreExtApi.checkForUpdates(extension.id);
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
    setInstallingPlugin(extension.id, true);
    try {
      const result = await coreExtApi?.checkAndUpdate?.(extension.id);
      if (result?.updated?.length > 0) {
        setInstallingPlugin(extension.id, false);
        const allInfo = Object.values(usePluginStore.getState().coreUpdateInfo);
        setCoreUpdateInfo(allInfo.map(info =>
          info.pluginId === extension.id ? { ...info, hasUpdate: false } : info
        ));
        toast.success(`${extension.name} updated.`);
        window.dispatchEvent(new Event('voiden:reloadPlugins'));
      } else if (result?.error) {
        setInstallingPlugin(extension.id, false);
        toast.error(`Update failed: ${result.error}`);
      } else {
        setInstallingPlugin(extension.id, false);
        toast.error(`Could not download update. Check your connection.`);
      }
    } catch {
      setInstallingPlugin(extension.id, false);
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

  const handleCheckCommunityUpdate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCheckingCommunityUpdate(true);
    try {
      const result = await refetchExtensions();
      const updated = result.data?.find((ex: any) => ex.id === extension.id);
      if (updated?.latestVersion) {
        toast.info(`Update available: v${updated.latestVersion}`);
      } else if (updated?.incompatibleLatestVersion) {
        toast.warning(`v${updated.incompatibleLatestVersion} requires Voiden ${updated.requiredVoidenVersion}`);
      } else {
        toast.success(`${extension.name} is up to date.`);
      }
    } finally {
      setIsCheckingCommunityUpdate(false);
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

          {/* Check for Update — community installed only */}
          {extension.type === "community" && !!extension.installedPath && (
            <DropdownMenu.Item
              onClick={handleCheckCommunityUpdate}
              disabled={isCheckingCommunityUpdate}
              className="w-full px-3 py-2 text-xs text-left text-text hover:bg-active outline-none cursor-pointer rounded-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={12} className={isCheckingCommunityUpdate ? "animate-spin" : ""} />
              {isCheckingCommunityUpdate ? "Checking..." : "Check for Update"}
            </DropdownMenu.Item>
          )}

          {/* Uninstall core — only if installed */}
          {extension.type === "core" && coreIsLocallyAvailable && (
            <>
              <DropdownMenu.Separator className="my-1 border-t border-border" />
              <DropdownMenu.Item
                onClick={handleUninstallCore}
                disabled={isUninstallingCore}
                className="w-full px-3 py-2 text-xs text-left hover:bg-active outline-none cursor-pointer text-text rounded-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="w-full px-3 py-2 text-xs text-left hover:bg-active outline-none cursor-pointer text-text rounded-sm flex items-center gap-2"
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
    if (extension.type === "core" && !coreIsLocallyAvailable) return null;
    if (extension.type === "community" && !extension.installedPath) return null;
    return renderContextMenu();
  };

  const isInstalled = extension.type === "community" ? !!extension.installedPath : coreIsLocallyAvailable;

  return (
    <div
      className={cn(
        "group mx-2 my-2 rounded-xl border border-border bg-panel/80 hover:bg-panel cursor-pointer transition-colors shadow-sm hover:shadow-md",
        !extension.enabled && isInstalled && "opacity-70"
      )}
      onClick={() => openExtensionDetailsMutation.mutate(extension)}
    >
      <div className="p-2 flex gap-3 items-start">
        {/* Left column — logo */}
        <div className="flex-shrink-0 self-center">
          <ExtensionIcon extension={extension} size="lg" />
        </div>

        {/* Right column */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">

          {/* Row 1: title + update badges + context menu gear */}
          <div className="flex items-center gap-2 min-w-0" onClick={(e) => e.stopPropagation()}>
            <h3
              className={cn("text-sm font-semibold truncate flex-1 min-w-0 cursor-pointer m-1", extension.enabled || !isInstalled ? "text-text" : "text-comment")}
              onClick={() => openExtensionDetailsMutation.mutate(extension)}
            >
              {extension.name}
            </h3>
            {/* Update / incompatible badges */}
            {((extension.installedPath && extension.latestVersion) || hasCompatibleUpdate) && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/20 text-blue-300 bg-blue-500/10 flex-shrink-0">
                Update
              </span>
            )}
            {(extension.incompatibleLatestVersion || hasIncompatibleUpdate) && (
              <Tip label={`v${updateInfo?.remoteVersion ?? extension.incompatibleLatestVersion} requires Voiden ${updateInfo?.requiredAppVersion ?? extension.requiredVoidenVersion}`} side="bottom" align="end">
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-accent bg-bg flex-shrink-0 cursor-default">
                  Incompatible
                </span>
              </Tip>
            )}
            {/* Error badge */}
            {error && error.kind === 'permission' ? (
              <Tip label={error.error} side="bottom" align="end">
                <button
                  onClick={(e) => { e.stopPropagation(); toast.warning(error.error); }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors flex-shrink-0"
                >
                  Permission
                </button>
              </Tip>
            ) : error ? (
              <Tip label={error.error} side="bottom" align="end">
                <button
                  onClick={(e) => { e.stopPropagation(); toast.error(error.error); }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors flex-shrink-0"
                >
                  Error
                </button>
              </Tip>
            ) : null}
            {/* Context menu — only for installed plugins */}
            {isInstalled && renderActions()}
          </div>

          {/* Row 2: version + type badge */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-comment">v{displayVersion}</span>
            <span className={cn("text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border", typeBadgeClass)}>
              {typeLabel}
            </span>
          </div>

          {/* Row 3: description */}
          {extension.description && (
            <p className="text-xs text-comment line-clamp-2 leading-relaxed">{extension.description}</p>
          )}

          {/* Row 4: author (left) + action buttons + enabled badge (right) */}
          <div className="flex items-center justify-between gap-2 mt-0.5" onClick={(e) => e.stopPropagation()}>
            <span className="text-[11px] text-comment truncate min-w-0">
              <span className="opacity-60">by </span>
              <span className="font-medium text-button-primary/80">{extension.author}</span>
            </span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Core: not installed → Install */}
              {extension.type === "core" && !coreIsLocallyAvailable && (
                installingCorePlugins?.[extension.id] ? (
                  <button disabled className="px-2 py-0.5 text-[10px] bg-button-primary/40 text-bg/60 rounded flex items-center gap-1 cursor-not-allowed">
                    <Loader2 size={10} className="animate-spin" /> Installing
                  </button>
                ) : (extension.incompatibleLatestVersion || hasIncompatibleUpdate) ? (
                  <button disabled className="px-2 py-0.5 text-[10px] bg-active/40 text-comment rounded cursor-not-allowed border border-border">
                    Install
                  </button>
                ) : (
                  <button onClick={handleInstallCore} className="px-2 py-0.5 text-[10px] bg-button-primary hover:bg-button-primary-hover text-bg rounded font-medium transition-colors">
                    Install
                  </button>
                )
              )}
              {/* Core: installed + compatible update */}
              {extension.type === "core" && coreIsLocallyAvailable && hasCompatibleUpdate && (
                installingCorePlugins?.[extension.id] ? (
                  <button disabled className="px-2 py-0.5 text-[10px] bg-button-primary/40 text-bg/60 rounded flex items-center gap-1 cursor-not-allowed">
                    <Loader2 size={10} className="animate-spin" /> Updating
                  </button>
                ) : (
                  <button onClick={handleUpdateCore} className="px-2 py-0.5 text-[10px] bg-button-primary hover:bg-button-primary-hover text-bg rounded font-medium transition-colors">
                    Update
                  </button>
                )
              )}
              {/* Community: not installed → Install */}
              {extension.type === "community" && !extension.installedPath && (
                installMutation.isPending ? (
                  <button disabled className="px-2 py-0.5 text-[10px] bg-button-primary/40 text-bg/60 rounded flex items-center gap-1 cursor-not-allowed">
                    <Loader2 size={10} className="animate-spin" /> Installing
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const versionToInstall = extension.latestVersion
                        ? { ...extension, version: extension.latestVersion, latestVersion: undefined }
                        : extension;
                      installMutation.mutate(versionToInstall);
                    }}
                    className="px-2 py-0.5 text-[10px] bg-button-primary hover:bg-button-primary-hover text-bg rounded font-medium transition-colors"
                  >
                    Install
                  </button>
                )
              )}
              {/* Community: installed + update available */}
              {extension.type === "community" && extension.installedPath && extension.latestVersion && (
                updateMutation.isPending ? (
                  <button disabled className="px-2 py-0.5 text-[10px] bg-button-primary/40 text-bg/60 rounded flex items-center gap-1 cursor-not-allowed">
                    <Loader2 size={10} className="animate-spin" /> Updating
                  </button>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); updateMutation.mutate(extension.id); }} className="px-2 py-0.5 text-[10px] bg-button-primary hover:bg-button-primary-hover text-bg rounded font-medium transition-colors">
                    Update
                  </button>
                )
              )}
              {/* Enabled/Disabled badge for installed plugins */}
              {isInstalled && (
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded border",
                  extension.enabled
                    ? "border-green-500/30 text-green-400 bg-green-500/10"
                    : "border-border text-comment bg-active/20"
                )}>
                  {extension.enabled ? "Enabled" : "Disabled"}
                </span>
              )}
            </div>
          </div>

        </div>
      </div>
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
  const { coreUpdateInfo, setCoreUpdateInfo } = usePluginStore();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "core" | "community" | "installed" | "updates">("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const doFetchRegistry = async () => {
    const coreExt = (window as any).electron?.coreExtensions;
    const extApi = (window as any).electron?.extensions;
    if (!coreExt?.fetchRegistry) return;
    setIsRefreshing(true);
    try {
      const result = await coreExt.fetchRegistry();
      const updated = await extApi?.getAll?.();
      if (updated) queryClient.setQueryData(["extensions"], updated);
      _lastRegistryFetch = Date.now();
      if (result?.newPluginCount > 0) {
        toast.success(
          result.newPluginCount === 1
            ? "1 new plugin available"
            : `${result.newPluginCount} new plugins available`
        );
      }
      await doCheckUpdates();
    } catch {
      // silently ignore — no network
    } finally {
      setIsRefreshing(false);
    }
  };

  const doCheckUpdates = async () => {
    const coreExt = (window as any).electron?.coreExtensions;
    if (!coreExt?.checkForUpdates) return;
    try {
      const result = await coreExt.checkForUpdates();
      if (result?.plugins?.length) {
        setCoreUpdateInfo(result.plugins);
        _lastUpdateCheck = Date.now();
      }
    } catch { /* silently ignore — no network */ }
  };

  // Auto-fetch registry once per session on first open
  useEffect(() => {
    if (_lastRegistryFetch > 0) return;
    doFetchRegistry();
  }, []);

  // Auto-check for updates once per session on first open so incompatible/update badges
  // are always visible without requiring a manual "Check Update" click.
  useEffect(() => {
    if (_lastUpdateCheck > 0) return;
    doCheckUpdates();
  }, []);

  useEffect(() => {
    if (installFromZip.isError) {
      toast.error((installFromZip.error as Error)?.message || "Failed to install extension");
    }
  }, [installFromZip.isError, installFromZip.error]);

  if (isLoading) return <ExtensionBrowserSkeleton />;

  const filteredExtensions = useMemo(() => {
    // Hide zip-installed plugins that have been uninstalled (no repo to reinstall from)
    let result = (extensions || []).filter((ext: Extension) =>
      !(ext.type === "community" && !ext.repo && !ext.installedPath)
    );

    if (category === "core" || category === "community") {
      result = result.filter((ext: Extension) => ext.type === category);
    } else if (category === "installed") {
      result = result.filter((ext: Extension) =>
        ext.type === "core" ? ext.isLocallyAvailable !== false : !!ext.installedPath
      );
    } else if (category === "updates") {
      result = result.filter((ext: Extension) => {
        if (ext.type === "core") return !!coreUpdateInfo?.[ext.id]?.hasUpdate;
        return !!(ext as any).latestVersion;
      });
    }

    const query = search.trim().toLowerCase();
    if (!query) return result;
    return result.filter((ext: Extension) =>
      [ext.name, ext.description, ext.author, ext.id].filter(Boolean).join(" ").toLowerCase().includes(query)
    );
  }, [extensions, search, category, coreUpdateInfo]);

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
          <Tip label="Refresh plugin registry" side="bottom">
            <button
              onClick={doFetchRegistry}
              disabled={isRefreshing}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-active transition-colors text-comment disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCw size={13} className={isRefreshing ? "animate-spin" : ""} />
            </button>
          </Tip>
          <Tip label="Install extension from zip file" side="bottom">
            <button
              onClick={() => installFromZip.mutate()}
              disabled={installFromZip.isPending}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-active transition-colors text-comment disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {installFromZip.isPending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            </button>
          </Tip>
        </div>

        {(() => {
          const FILTERS = [
            { id: "all",       label: "All Extensions",  icon: Globe         },
            { id: "core",      label: "Core",            icon: Cpu           },
            { id: "community", label: "Community",       icon: Users         },
            { id: "installed", label: "Installed",       icon: HardDrive     },
            { id: "updates",   label: "Updates",         icon: ArrowUpCircle },
          ] as const;
          const active = FILTERS.find((f) => f.id === category) ?? FILTERS[0];
          return (
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center gap-2 h-8 px-3 bg-bg border border-border rounded-lg text-xs text-text hover:bg-panel transition-colors w-full">
                  <active.icon size={12} className="text-button-primary flex-shrink-0" />
                  <span className="flex-1 text-left font-medium">{active.label}</span>
                  <ChevronDown size={12} className="text-comment flex-shrink-0" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="bottom" align="start" sideOffset={4}
                  className="bg-editor z-[9999] outline-none w-[var(--radix-dropdown-menu-trigger-width)] border border-border rounded-md shadow-lg p-1"
                >
                  {FILTERS.map((f) => (
                    <DropdownMenu.Item
                      key={f.id}
                      onClick={() => setCategory(f.id)}
                      className="flex items-center gap-2.5 px-3 py-2 text-xs text-text hover:bg-panel outline-none cursor-pointer rounded-sm"
                    >
                      <f.icon size={12} className={cn(category === f.id ? "text-button-primary" : "text-comment")} />
                      <span className={cn("flex-1", category === f.id ? "text-text font-medium" : "text-comment")}>{f.label}</span>
                      {category === f.id && <Check size={11} className="text-button-primary flex-shrink-0" />}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          );
        })()}
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
