import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as LucideIcons from "lucide-react";
import { proseClassesSm } from "@/core/editors/voiden/VoidenEditor";
import { GitBranch, Loader2, Shield, Users, RefreshCw, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { openExternalLink } from "@/core/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  useInstallExtension,
  useUninstallExtension,
  useSetExtensionEnabled,
  useUpdateExtension,
  useGetExtensions,
} from "@/core/extensions/hooks";
import { usePluginStore } from "@/plugins";
import { toast } from "@/core/components/ui/sonner";
import { cn } from "@/core/lib/utils";
import logo from "@/assets/logo-dark.png";

interface CustomLinkProps {
  href?: string;
  children: React.ReactNode;
}

export const CustomLink = ({ href, children }: CustomLinkProps) => (
  <a className="cursor-pointer" onClick={() => href && openExternalLink(href)}>{children}</a>
);

const ExtensionIcon = ({ extension }: { extension: any }) => {
  const icon: string | undefined = extension.icon;

  if (icon) {
    if (icon.startsWith("http") || icon.startsWith("data:")) {
      return (
        <div className="w-14 h-14 rounded-xl bg-active/30 flex items-center justify-center overflow-hidden border border-border flex-shrink-0">
          <img src={icon} className="w-full h-full object-cover" alt={extension.name} />
        </div>
      );
    }
    const LucideIcon = (LucideIcons as Record<string, any>)[icon] as React.ComponentType<{ size?: number; className?: string }> | undefined;
    if (LucideIcon) {
      return (
        <div className="w-14 h-14 rounded-xl bg-active/30 flex items-center justify-center border border-border flex-shrink-0">
          <LucideIcon size={28} className="text-foreground" />
        </div>
      );
    }
  }

  if (extension.type === "core") {
    return (
      <div className="w-14 h-14 rounded-xl bg-active/30 flex items-center justify-center overflow-hidden border border-border flex-shrink-0">
        <img src={logo} className="w-9 h-9 object-contain" alt="Voiden" />
      </div>
    );
  }
  return (
    <div className="w-14 h-14 rounded-xl bg-active/30 flex items-center justify-center border border-border flex-shrink-0">
      <Users size={24} className="text-comment" />
    </div>
  );
};

const ChangelogEntry = ({ entry }: { entry: any }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-panel hover:bg-active/30 transition-colors text-left"
      >
        {open ? <ChevronDown size={14} className="text-comment flex-shrink-0" /> : <ChevronRight size={14} className="text-comment flex-shrink-0" />}
        <div className="flex items-center justify-between flex-1 min-w-0 gap-4">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-mono font-semibold text-button-primary flex-shrink-0">{entry.version}</span>
            {entry.title && (
              <>
                <span className="text-[11px] text-comment/40 flex-shrink-0">—</span>
                <span className="text-xs text-comment truncate">{entry.title}</span>
              </>
            )}
          </div>
          {entry.date && (
            <span className="text-[11px] text-comment/50 flex-shrink-0 tabular-nums">{entry.date}</span>
          )}
        </div>
      </button>
      {open && (
        <div className="px-4 py-3 bg-bg border-t border-border space-y-3">
          {entry.description && (
            <p className="text-xs text-comment leading-relaxed">{entry.description}</p>
          )}
          {entry.changes && (Object.entries(entry.changes as Record<string, string[]>)
            .filter(([, items]) => items?.length > 0)
            .map(([label, items]) => (
              <div key={label}>
                <p className="text-sm font-semibold text-text mb-1.5">{label}</p>
                <ul className="space-y-1.5 ml-1">
                  {items.map((item, i) => (
                    <li key={i} className="flex gap-2 text-xs text-comment leading-relaxed">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-comment flex-shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const ALL_TABS = ["Documentation", "Capabilities", "Features", "Changelog"] as const;
type Tab = typeof ALL_TABS[number];

export const ExtensionDetails = ({
  extensionData: initialExtensionData,
  content,
}: {
  extensionData: any;
  content: string;
}) => {
  const { data: allExtensions, refetch: refetchExtensions } = useGetExtensions();
  const extensionData =
    allExtensions?.find((e: any) => e.id === initialExtensionData?.id) ?? initialExtensionData;

  const queryClient = useQueryClient();
  const installMutation = useInstallExtension();
  const uninstallMutation = useUninstallExtension();
  const toggleEnabledMutation = useSetExtensionEnabled();
  const updateMutation = useUpdateExtension();
  const { pluginErrors, coreUpdateInfo, installingCorePlugins, setInstallingPlugin, setCoreUpdateInfo } =
    usePluginStore();

  const [activeTab, setActiveTab] = useState<Tab>("Documentation");
  const [readme, setReadme] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [changelog, setChangelog] = useState<any[] | null>(null);
  const [remoteManifest, setRemoteManifest] = useState<any | null>(null);

  useEffect(() => {
    if (!extensionData?.repo) return;
    setReadme(null);
    setReadmeLoading(true);
    const api = (window as any).electron?.extensions;
    api?.fetchReadme?.(extensionData.repo)
      .then((r: string) => setReadme(r || null))
      .catch(() => setReadme(null))
      .finally(() => setReadmeLoading(false));
  }, [extensionData?.repo]);

  useEffect(() => {
    if (!extensionData?.repo) return;
    setChangelog(null);
    const api = (window as any).electron?.extensions;
    api?.fetchChangelog?.(extensionData.id, extensionData.repo)
      .then((data: any[] | null) => {
        if (data?.length) setChangelog(data);
      })
      .catch(() => {});
  }, [extensionData?.id, extensionData?.repo]);

  // For community plugins without features/capabilities in the registry entry,
  // fetch the full manifest from the GitHub release on-demand.
  const needsManifest = extensionData?.type === "community"
    && !extensionData?.features?.length
    && !extensionData?.capabilities
    && !!extensionData?.repo;

  useEffect(() => {
    if (!needsManifest) return;
    setRemoteManifest(null);
    const api = (window as any).electron?.extensions;
    api?.fetchManifest?.(extensionData.id, extensionData.repo)
      .then((m: any) => setRemoteManifest(m || null))
      .catch(() => {});
  }, [extensionData?.id, extensionData?.repo, needsManifest]);

  const error = pluginErrors.find((err) => err.extensionId === extensionData.id);
  const updateInfo = extensionData.type === "core" ? coreUpdateInfo?.[extensionData.id] : undefined;
  const hasCompatibleUpdate = updateInfo?.hasUpdate && updateInfo?.compatible;
  const hasIncompatibleUpdate = updateInfo?.hasUpdate && !updateInfo?.compatible;
  const coreIsLocallyAvailable =
    extensionData.type !== "core" || extensionData.isLocallyAvailable !== false;

  const displayVersion =
    (window as any).__voiden_ota_manifests__?.[extensionData.id]?.version ?? extensionData.version;

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isUninstallingCore, setIsUninstallingCore] = useState(false);
  const [isCheckingCommunityUpdate, setIsCheckingCommunityUpdate] = useState(false);

  const coreExtApi = () => (window as any).electron?.coreExtensions;

  const invalidateCoreState = () =>
    queryClient.invalidateQueries({ queryKey: ["extensions"] });

  const activateBundled = async () => {
    await window.electron?.extensions.reinstallCore?.(extensionData.id);
    await invalidateCoreState();
  };

  const handleInstallCore = async () => {
    setInstallingPlugin(extensionData.id, true);
    try {
      // 1. Always try OTA first.
      const result = await coreExtApi()?.checkAndUpdate?.(extensionData.id);

      if (result?.updated?.length > 0) {
        // OTA download succeeded — enable the plugin (also clears uninstalled state).
        await toggleEnabledMutation.mutateAsync({ extensionId: extensionData.id, enabled: true });
        setInstallingPlugin(extensionData.id, false);
        toast.success(`${extensionData.name} installed.`);
        return;
      }

      if (result?.incompatible?.includes(extensionData.id)) {
        // Remote version requires a newer Voiden — fall back to bundled if available.
        await activateBundled();
        // Persist incompatibility badge in the query cache so the card and detail show it without re-fetching.
        const details = result.incompatibleVersions?.[extensionData.id];
        if (details) {
          queryClient.setQueryData<any[]>(["extensions"], (old) =>
            old?.map((e: any) =>
              e.id === extensionData.id
                ? { ...e, incompatibleLatestVersion: details.version, requiredVoidenVersion: details.requiredVoidenVersion }
                : e
            ) ?? old
          );
        }
        setInstallingPlugin(extensionData.id, false);
        const fresh = queryClient.getQueryData<any[]>(["extensions"])?.find((e: any) => e.id === extensionData.id);
        if (fresh?.isLocallyAvailable) {
          toast.warning(`Latest version of ${extensionData.name} requires a newer Voiden. Enabled bundled version.`);
        } else {
          toast.error(`${extensionData.name} requires a newer Voiden. Update the app to install.`);
        }
        return;
      }

      if (result?.error) {
        // Network or other error — fall back to bundled if available.
        await activateBundled();
        setInstallingPlugin(extensionData.id, false);
        const fresh = queryClient.getQueryData<any[]>(["extensions"])?.find((e: any) => e.id === extensionData.id);
        if (fresh?.isLocallyAvailable) {
          toast.warning(`Could not reach server. Enabled bundled version of ${extensionData.name}.`);
        } else {
          toast.error(`Could not download ${extensionData.name}. Check your connection.`);
        }
        return;
      }

      // upToDate with no updates — fall back to bundled.
      await activateBundled();
      setInstallingPlugin(extensionData.id, false);
    } catch {
      setInstallingPlugin(extensionData.id, false);
      toast.error("Install failed unexpectedly.");
    }
  };

  const handleCheckForUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const api = coreExtApi();
      if (!api?.checkForUpdates) return;
      const result = await api.checkForUpdates(extensionData.id);
      if (result?.error) { toast.error(`Update check failed: ${result.error}`); return; }
      if (result?.plugins?.length) setCoreUpdateInfo(result.plugins);
      const thisPlugin = result?.plugins?.find((p: any) => p.pluginId === extensionData.id);
      if (thisPlugin?.hasUpdate && thisPlugin?.compatible) {
        toast.info(`Update available: v${thisPlugin.remoteVersion}`);
      } else if (thisPlugin?.hasUpdate && !thisPlugin?.compatible) {
        toast.warning(`v${thisPlugin.remoteVersion} requires Voiden ${thisPlugin.requiredAppVersion}`);
      } else {
        toast.success(`${extensionData.name} is up to date.`);
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleUpdateCore = async () => {
    setInstallingPlugin(extensionData.id, true);
    try {
      const result = await coreExtApi()?.checkAndUpdate?.(extensionData.id);
      if (result?.updated?.length > 0) {
        setInstallingPlugin(extensionData.id, false);
        const allInfo = Object.values(usePluginStore.getState().coreUpdateInfo);
        setCoreUpdateInfo(allInfo.map(info =>
          info.pluginId === extensionData.id ? { ...info, hasUpdate: false } : info
        ));
        toast.success(`${extensionData.name} updated.`);
        window.dispatchEvent(new Event('voiden:reloadPlugins'));
      } else if (result?.error) {
        setInstallingPlugin(extensionData.id, false);
        toast.error(`Update failed: ${result.error}`);
      } else {
        setInstallingPlugin(extensionData.id, false);
        toast.error("Could not download update. Check your connection.");
      }
    } catch {
      setInstallingPlugin(extensionData.id, false);
      toast.error("Update failed unexpectedly.");
    }
  };

  const handleUninstallCore = async () => {
    setIsUninstallingCore(true);
    try {
      // deleteCache marks the plugin as uninstalled (clears isLocallyAvailable for bundled plugins too)
      // and removes the OTA bundle. No need to call setEnabled separately.
      await coreExtApi()?.deleteCache?.(extensionData.id);
      await invalidateCoreState();
      toast.success(`${extensionData.name} removed. Click Install to re-download.`);
    } catch {
      toast.error("Failed to uninstall plugin.");
    } finally {
      setIsUninstallingCore(false);
    }
  };

  const handleCheckCommunityUpdate = async () => {
    setIsCheckingCommunityUpdate(true);
    try {
      const result = await refetchExtensions();
      const updated = result.data?.find((e: any) => e.id === extensionData.id);
      if (updated?.latestVersion) {
        toast.info(`Update available: v${updated.latestVersion}`);
      } else if (updated?.incompatibleLatestVersion) {
        toast.warning(`v${updated.incompatibleLatestVersion} requires Voiden ${updated.requiredVoidenVersion}`);
      } else {
        toast.success(`${extensionData.name} is up to date.`);
      }
    } finally {
      setIsCheckingCommunityUpdate(false);
    }
  };

  const capabilities = extensionData.capabilities || remoteManifest?.capabilities || {};
  const features = extensionData.features || remoteManifest?.features || [];

  const hasUiButtons  = (capabilities.ui?.buttons?.length ?? 0) > 0;
  const hasUiPanels   = (capabilities.ui?.panels?.length ?? 0) > 0;
  const hasBlocks     = !!capabilities.blocks;
  const hasSlash      = !!capabilities.slashCommands;
  const hasPaste      = (capabilities.paste?.patterns?.length ?? 0) > 0;
  const hasPipeline   = !!capabilities.requestPipeline;
  const hasCapabilities = hasUiButtons || hasUiPanels || hasBlocks || hasSlash || hasPaste || hasPipeline;

  const availableTabs = ALL_TABS.filter((tab) => {
    if (tab === "Capabilities") return hasCapabilities;
    if (tab === "Features") return features.length > 0;
    return true;
  });

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab("Documentation");
    }
  }, [hasCapabilities, features.length]);

  const renderTypeBadge = () => (
    extensionData.type === "core" ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-400 bg-purple-500/10">
        <Shield size={10} /> Core
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded border border-orange-500/30 text-orange-400 bg-orange-500/10">
        <Users size={10} /> Community
      </span>
    )
  );

  const renderActions = () => {
    if (extensionData.type === "core") {
      if (!coreIsLocallyAvailable) {
        if (extensionData.incompatibleLatestVersion) {
          return (
            <button disabled className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-active/40 text-comment cursor-not-allowed border border-border">
              Install
            </button>
          );
        }
        return installingCorePlugins[extensionData.id] ? (
          <button disabled className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-button-primary/40 text-bg/60 cursor-not-allowed">
            <Loader2 size={11} className="animate-spin" /> Installing...
          </button>
        ) : (
          <button onClick={handleInstallCore} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-button-primary hover:bg-button-primary-hover text-bg font-medium transition-colors shadow-sm">
            Install
          </button>
        );
      }
      return (
        <>
          <button
            onClick={() => toggleEnabledMutation.mutate({ extensionId: extensionData.id, enabled: !extensionData.enabled })}
            className="inline-flex items-center px-3 py-1.5 text-xs rounded-md border border-border bg-panel hover:bg-bg text-text transition-colors"
          >
            {toggleEnabledMutation.isPending ? "..." : extensionData.enabled ? "Disable" : "Enable"}
          </button>

          {hasCompatibleUpdate && (
            installingCorePlugins[extensionData.id] ? (
              <button disabled className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-button-primary/40 text-bg/60 cursor-not-allowed">
                <Loader2 size={11} className="animate-spin" /> Updating...
              </button>
            ) : (
              <button onClick={handleUpdateCore} className="inline-flex items-center px-3 py-1.5 text-xs rounded-md bg-button-primary hover:bg-button-primary-hover text-bg font-medium transition-colors shadow-sm">
                Update
              </button>
            )
          )}

          {!hasCompatibleUpdate && (
            <button
              onClick={handleCheckForUpdate}
              disabled={isCheckingUpdate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-panel hover:bg-active text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw size={11} className={isCheckingUpdate ? "animate-spin" : ""} />
              {isCheckingUpdate ? "Checking..." : "Check Update"}
            </button>
          )}

          <button
            onClick={handleUninstallCore}
            disabled={isUninstallingCore}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-panel hover:bg-bg  transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isUninstallingCore ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            Uninstall
          </button>
        </>
      );
    }

    if (extensionData.type === "community") {
      if (!extensionData.installedPath) {
        // If a compatible newer version exists, install it directly.
        // If the latest is incompatible, install the current (older) version — the
        // incompatibility badge will appear naturally after install.
        const versionToInstall = extensionData.latestVersion
          ? { ...extensionData, version: extensionData.latestVersion, latestVersion: undefined }
          : extensionData;
        return (
          <button onClick={() => installMutation.mutate(versionToInstall)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-button-primary hover:bg-button-primary-hover text-bg font-medium transition-colors shadow-sm">
            {installMutation.isPending ? <><Loader2 size={11} className="animate-spin" /> Installing...</> : "Install"}
          </button>
        );
      }
      return (
        <>
          <button
            onClick={() => toggleEnabledMutation.mutate({ extensionId: extensionData.id, enabled: !extensionData.enabled })}
            className="inline-flex items-center px-3 py-1.5 text-xs rounded-md border border-border bg-panel hover:bg-active text-text transition-colors"
          >
            {toggleEnabledMutation.isPending ? "..." : extensionData.enabled ? "Disable" : "Enable"}
          </button>
          {extensionData.latestVersion ? (
            <button onClick={() => updateMutation.mutate(extensionData.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-button-primary hover:bg-button-primary-hover text-bg font-medium transition-colors shadow-sm">
              {updateMutation.isPending ? <><Loader2 size={11} className="animate-spin" /> Updating...</> : "Update"}
            </button>
          ) : (
            <button
              onClick={handleCheckCommunityUpdate}
              disabled={isCheckingCommunityUpdate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-panel hover:bg-active text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw size={11} className={isCheckingCommunityUpdate ? "animate-spin" : ""} />
              {isCheckingCommunityUpdate ? "Checking..." : "Check Update"}
            </button>
          )}
          <button
            onClick={() => uninstallMutation.mutate(extensionData.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-panel hover:bg-button-danger hover:border-button-danger hover:text-bg transition-colors"
          >
            <Trash2 size={11} /> Uninstall
          </button>
        </>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* ── Fixed header ── */}
      <div className="flex-shrink-0 border-b border-border bg-editor px-5 py-4">
        <div className="flex items-center gap-4">
          <ExtensionIcon extension={extensionData} />

          <div className="flex flex-col gap-3 flex-1 min-w-0">
            {/* Name + badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-semibold text-text leading-none">{extensionData.name}</h1>
              {renderTypeBadge()}
              {hasCompatibleUpdate && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400 bg-blue-500/10 font-medium">
                  Update available to v{updateInfo?.remoteVersion}
                </span>
              )}
              {hasIncompatibleUpdate && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-accent bg-bg font-medium">
                  v{updateInfo?.remoteVersion} — needs Voiden {updateInfo?.requiredAppVersion}
                </span>
              )}
              {extensionData.type === "community" && extensionData.installedPath && extensionData.latestVersion && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400 bg-blue-500/10 font-medium">
                  Update available to v{extensionData.latestVersion}
                </span>
              )}
              {extensionData.incompatibleLatestVersion && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-accent bg-bg font-medium">
                  v{extensionData.incompatibleLatestVersion} — needs Voiden {extensionData.requiredVoidenVersion}
                </span>
              )}
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-1.5 text-[11px] text-comment">
              <span className="font-mono">{displayVersion}</span>
              <span className="opacity-30">·</span>
              <span>{extensionData.author}</span>
              {extensionData.type === "core" && (
                <>
                  <span className="opacity-30">·</span>
                  <span className={cn(
                    !coreIsLocallyAvailable ? "text-comment/40"
                    : extensionData.enabled ? "text-text"
                    : "text-comment"
                  )}>
                    {!coreIsLocallyAvailable ? "Not installed" : extensionData.enabled ? "Enabled" : "Disabled"}
                  </span>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {renderActions()}
              {error && (
                <button
                  onClick={() => toast.error(error.error)}
                  className="inline-flex items-center px-3 py-1.5 text-xs rounded border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  Error
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        {extensionData.description && (
          <p className="mt-3 text-xs text-comment leading-relaxed">{extensionData.description}</p>
        )}

        {/* Source link */}
        {extensionData.repo && (
          <button
            onClick={() => openExternalLink(`https://github.com/${extensionData.repo}`)}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-button-primary hover:text-button-primary-hover transition-colors"
          >
            <GitBranch size={12} />
            View Source
          </button>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="flex-shrink-0 flex items-center gap-0 border-b border-border px-5 bg-editor">
        {availableTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-3 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab
                ? "border-button-primary text-text"
                : "border-transparent text-comment hover:text-text"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 bg-panel">
        {activeTab === "Documentation" && (
          readmeLoading
            ? <div className="flex items-center justify-center h-full">
                <p className="text-xs text-comment animate-pulse">Loading documentation...</p>
              </div>
            : (readme || content)
              ? <div className={`prose max-w-none ${proseClassesSm}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => <CustomLink href={href}>{children}</CustomLink>,
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-3 rounded-md border border-border">
                          <table className="w-full border-collapse">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead>{children}</thead>,
                      th: ({ children }) => (
                        <th className="px-3 py-2 text-left text-[11px] font-semibold text-text uppercase tracking-wider border-0 border-b border-border bg-panel">{children}</th>
                      ),
                      td: ({ children }) => (
                        <td className="px-3 py-2 text-sm text-text border-0 border-b border-border">{children}</td>
                      ),
                      tr: ({ children }) => <tr className="hover:bg-active/30 transition-colors [&:last-child_td]:!border-b-0">{children}</tr>,
                    }}
                  >
                    {readme || content}
                  </ReactMarkdown>
                </div>
              : <div className="flex flex-col items-center justify-center h-full gap-1.5 text-center">
                  <p className="text-sm font-medium text-comment/60">No documentation</p>
                  <p className="text-xs text-comment/40">This plugin has no readme.</p>
                </div>
        )}

        {activeTab === "Capabilities" && (
          hasCapabilities ? (
            <>
              {(hasUiButtons || hasUiPanels) && (
                <div className="mb-5">
                  <h4 className="text-xs font-semibold text-text/80 uppercase tracking-wider mb-2">UI</h4>
                  {hasUiButtons && (
                    <div className="mb-3">
                      <p className="text-[11px] text-comment/60 uppercase tracking-wider mb-1.5">Buttons</p>
                      {capabilities.ui.buttons.map((btn: any) => (
                        <div key={btn.id} className="mb-1.5 bg-bg px-3 py-2 rounded border border-border">
                          <p className="text-xs font-medium text-text/80">{btn.tooltip || btn.id}</p>
                          {btn.description && <p className="text-[11px] text-comment mt-0.5">{btn.description}</p>}
                          {btn.location && <p className="text-[11px] text-comment/50 mt-0.5 font-mono">{btn.location}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {hasUiPanels && (
                    <div>
                      <p className="text-[11px] text-comment/60 uppercase tracking-wider mb-1.5">Panels</p>
                      {capabilities.ui.panels.map((panel: any) => (
                        <div key={panel.id} className="mb-1.5 bg-bg px-3 py-2 rounded border border-border">
                          <p className="text-xs font-medium text-text/80">{panel.title || panel.id}</p>
                          {panel.description && <p className="text-[11px] text-comment mt-0.5">{panel.description}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {hasBlocks && (
                <div className="mb-5">
                  <h4 className="text-xs font-semibold text-text/80 uppercase tracking-wider mb-2">Blocks</h4>
                  {capabilities.blocks.description && (
                    <p className="text-xs text-comment mb-2">{capabilities.blocks.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {capabilities.blocks.owns?.map((block: string) => (
                      <span key={block} className="px-2 py-0.5 bg-active border border-border rounded text-[11px] font-mono text-comment">{block}</span>
                    ))}
                  </div>
                </div>
              )}
              {hasSlash && (
                <div className="mb-5">
                  <h4 className="text-xs font-semibold text-text/80 uppercase tracking-wider mb-2">Slash Commands</h4>
                  {capabilities.slashCommands.groups?.map((group: any) => (
                    <div key={group.name} className="mb-3">
                      <p className="text-xs font-medium text-text/70 mb-1">{group.name}</p>
                      <ul className="space-y-1 ml-2">
                        {group.commands?.map((cmd: string, idx: number) => (
                          <li key={idx} className="flex gap-2 text-xs text-comment">
                            <span className="mt-1.5 w-1 h-1 rounded-full bg-comment/40 flex-shrink-0" />
                            {cmd}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {hasPaste && (
                <div className="mb-5">
                  <h4 className="text-xs font-semibold text-text/80 uppercase tracking-wider mb-2">Paste Handlers</h4>
                  {capabilities.paste.patterns.map((pattern: any) => (
                    <div key={pattern.name} className="mb-2 bg-bg px-3 py-2 rounded border border-border">
                      <p className="text-xs font-medium text-text/80">{pattern.name}</p>
                      {pattern.description && <p className="text-[11px] text-comment mt-0.5">{pattern.description}</p>}
                    </div>
                  ))}
                </div>
              )}
              {hasPipeline && (
                <div>
                  <h4 className="text-xs font-semibold text-text/80 uppercase tracking-wider mb-2">Request Pipeline</h4>
                  <p className="text-xs text-comment">{capabilities.requestPipeline.description}</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-1.5 text-center">
              <p className="text-sm font-medium text-comment/60">No capabilities</p>
              <p className="text-xs text-comment/40">This plugin declares no capabilities.</p>
            </div>
          )
        )}

        {activeTab === "Features" && (
          features.length > 0
            ? <ul className="space-y-1.5">
                {features.map((feature: string, idx: number) => (
                  <li key={idx} className="flex gap-2 text-xs text-comment leading-relaxed">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-comment flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            : <div className="flex flex-col items-center justify-center h-full gap-1.5 text-center">
                <p className="text-sm font-medium text-comment/60">No features listed</p>
                <p className="text-xs text-comment/40">This plugin has no feature descriptions.</p>
              </div>
        )}

        {activeTab === "Changelog" && (
          changelog && changelog.length > 0
            ? <div className="space-y-2">
                {changelog.map((entry, i) => <ChangelogEntry key={i} entry={entry} />)}
              </div>
            : <div className="flex flex-col items-center justify-center h-full gap-1.5 text-center">
                <p className="text-sm font-medium text-comment/60">No changelog</p>
                <p className="text-xs text-comment/40">No changelog available for this plugin.</p>
              </div>
        )}
      </div>
    </div>
  );
};

export default ExtensionDetails;
