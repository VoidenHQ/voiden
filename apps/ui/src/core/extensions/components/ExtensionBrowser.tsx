import { Search, Settings, Loader2, Shield, BadgeCheck, Users, Upload } from "lucide-react";
import { useEffect } from "react";
import {
  useGetExtensions,
  useInstallExtension,
  useInstallExtensionFromZip,
  useUninstallExtension,
  useSetExtensionEnabled,
  useOpenExtensionDetails,
  useUpdateExtension,
} from "@/core/extensions/hooks";
import type { Extension } from "@/types";
import { cn } from "@/core/lib/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { usePluginStore } from "@/plugins";
import { toast } from "@/core/components/ui/sonner";

const ExtensionItem = ({ extension }: { extension: Extension }) => {
  const installMutation = useInstallExtension();
  const uninstallMutation = useUninstallExtension();
  const toggleEnabledMutation = useSetExtensionEnabled();
  const openExtensionDetailsMutation = useOpenExtensionDetails();
  const updateMutation = useUpdateExtension();
  const { pluginErrors } = usePluginStore();

  const error = pluginErrors.find((err) => err.extensionId === extension.id);

  const renderTypeIcon = () => {
    switch (extension.type) {
      case "core":
        return (
          <Shield
            size={16}
            className="text-purple-400 flex-shrink-0"
            title="Core Extension"
          />
        );
      case "verified":
        return (
          <BadgeCheck
            size={16}
            className="text-blue-400 flex-shrink-0"
            title="Verified Extension"
          />
        );
      case "community":
        return (
          <Users
            size={16}
            className="text-orange-400 flex-shrink-0"
            title="Community Extension"
          />
        );
      default:
        return null;
    }
  };

  const handleToggleEnabled = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    toggleEnabledMutation.mutate({
      extensionId: extension.id,
      enabled: !extension.enabled,
    });
  };

  const renderSettingsMenu = () => (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild onClick={(e) => e.stopPropagation()}>
        <button className="w-6 h-6 hover:bg-active flex justify-center items-center outline-none rounded transition-colors border border-transparent hover:border-border">
          <Settings size={14} className="text-comment hover:text-text transition-colors" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="start"
          sideOffset={12}
          className="bg-editor z-[9999] outline-none min-w-[140px] border border-border rounded-md shadow-lg"
        >
          <DropdownMenu.Item
            onClick={handleToggleEnabled}
            className="w-full px-3 py-2 text-xs text-left text-text hover:bg-active outline-none cursor-pointer rounded-sm mx-1 my-0.5"
          >
            {extension.enabled ? "Disable" : "Enable"}
          </DropdownMenu.Item>
          {extension.type === "community" && (
            <DropdownMenu.Item
              onClick={() => uninstallMutation.mutate(extension.id)}
              className="w-full px-3 py-2 text-xs text-left hover:bg-active outline-none cursor-pointer text-red-400 hover:text-red-300 rounded-sm mx-1 my-0.5"
            >
              Uninstall
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  const renderActions = () => {
    if (extension.type === "community") {
      if (!extension.installedPath) {
        if (installMutation.isPending) {
          return (
            <button
              disabled
              className="px-2 py-1 bg-active text-xs flex items-center gap-1 rounded border border-border"
            >
              <Loader2 size={12} className="animate-spin" />
              Installing
            </button>
          );
        }
        return (
          <button
            onClick={() => installMutation.mutate(extension)}
            className="px-2 py-1 bg-accent hover:bg-accent/90 text-bg text-xs rounded transition-colors"
          >
            Install
          </button>
        );
      }
      if (extension.latestVersion) {
        if (updateMutation.isPending) {
          return (
            <button
              disabled
              className="px-2 py-1 bg-active text-xs flex items-center gap-1 rounded border border-border"
            >
              <Loader2 size={12} className="animate-spin" />
              Updating
            </button>
          );
        }
        return (
          <button
            onClick={() => updateMutation.mutate(extension.id)}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
          >
            Update
          </button>
        );
      }
      return renderSettingsMenu();
    }
    return renderSettingsMenu();
  };

  return (
    <div
      className={cn(
        "group relative mx-2 my-1.5 rounded-lg border border-border bg-editor hover:bg-active cursor-pointer transition-colors",
        "min-h-[80px]",
        !extension.enabled && "opacity-60"
      )}
      onClick={() => openExtensionDetailsMutation.mutate(extension)}
    >
      {/* Main content area */}
      <div className="p-3 pr-10">
        <div className="flex items-start gap-2.5 mb-2">
          {renderTypeIcon()}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
              <h3 className={cn(
                "text-sm font-semibold truncate",
                extension.enabled ? "text-text" : "text-comment"
              )}>
                {extension.name}
              </h3>
              <span className="text-xs text-comment flex-shrink-0">
                v{extension.version}
              </span>
            </div>
            <p className="text-xs text-comment line-clamp-2 mb-1.5">
              {extension.description}
            </p>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-comment">by</span>
              <span className="font-medium text-accent">{extension.author}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions - positioned absolutely to avoid overlap */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {error && (
          <button
            onClick={(e) => { e.stopPropagation(); toast.error(error.error); }}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Error
          </button>
        )}
        {renderActions()}
      </div>

      {/* Status indicator */}
      {extension.enabled && (
        <div className="absolute bottom-2 right-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
        </div>
      )}
    </div>
  );
};

export const ExtensionBrowser = () => {
  const { data: extensions, isLoading } = useGetExtensions();
  const installFromZip = useInstallExtensionFromZip();

  useEffect(() => {
    if (installFromZip.isError) {
      toast.error((installFromZip.error as Error)?.message || "Failed to install extension");
    }
  }, [installFromZip.isError, installFromZip.error]);

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="flex flex-col h-full">
      {/* <div className="flex items-center gap-2 h-8 px-2 bg-stone-900 border-b border-stone-700/80">
        <div className="w-4 flex-none">
          <Search size={14} />
        </div>

        <input
          placeholder="Search extensions..."
          className="flex-1 bg-transparent outline-none text-base placeholder:text-stone-400 truncate min-w-0"
          type="text"
        />
      </div> */}

      <div className="px-2 pt-2">
        <button
          onClick={() => installFromZip.mutate()}
          disabled={installFromZip.isPending}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs text-comment hover:text-text bg-editor hover:bg-active border border-border rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {installFromZip.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Upload size={14} />
          )}
          {installFromZip.isPending ? "Installing..." : "Install from file"}
        </button>
      </div>

      <div className=" border-border flex-1 flex flex-col mb-1.5 overflow-y-scroll" >
        <div className="bg-bg h-full  border-border  mb-2">
          {extensions?.map((extension) => <ExtensionItem key={extension.id} extension={extension} />)}
        </div>
      </div>
    </div>
  );
};
