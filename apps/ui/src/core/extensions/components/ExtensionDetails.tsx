import React from "react";
import ReactMarkdown from "react-markdown";
import { proseClasses } from "@/core/editors/voiden/VoidenEditor";
import { GitBranch, Loader2, Shield, BadgeCheck, Users } from "lucide-react";
import { openExternalLink } from "@/core/lib/utils";
import { useInstallExtension, useUninstallExtension, useSetExtensionEnabled, useUpdateExtension, useGetExtensions } from "@/core/extensions/hooks";
import { usePluginStore } from "@/plugins";

interface CustomLinkProps {
  href?: string;
  children: React.ReactNode;
}

export const CustomLink = ({ href, children }: CustomLinkProps) => {
  return (
    <a
      onClick={() => {
        href && openExternalLink(href);
      }}
    >
      {children}
    </a>
  );
};

export const ExtensionDetails = ({ extensionData: initialExtensionData, content }: { extensionData: any; content: string }) => {
  const { data: allExtensions } = useGetExtensions();
  // Use live data from the query if available, fall back to the initial prop
  const extensionData = allExtensions?.find((e: any) => e.id === initialExtensionData?.id) ?? initialExtensionData;

  // Mutation hooks for community extensions (only applicable if extensionData.type === "community")
  const installMutation = useInstallExtension();
  const uninstallMutation = useUninstallExtension();
  const toggleEnabledMutation = useSetExtensionEnabled();
  const updateMutation = useUpdateExtension();
  const { pluginErrors } = usePluginStore();
  const error = pluginErrors.find((err) => err.extensionId === extensionData.id);

  const renderTypeIndicator = () => {
    switch (extensionData.type) {
      case "core":
        return (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-purple-500/10 border border-purple-500/30 rounded text-purple-400">
            <Shield size={14} />
            <span className="text-xs font-medium uppercase tracking-wide">Core</span>
          </div>
        );
      case "verified":
        return (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400">
            <BadgeCheck size={14} />
            <span className="text-xs font-medium uppercase tracking-wide">Verified</span>
          </div>
        );
      case "community":
        return (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-orange-500/10 border border-orange-500/30 rounded text-orange-400">
            <Users size={14} />
            <span className="text-xs font-medium uppercase tracking-wide">Community</span>
          </div>
        );
      default:
        return null;
    }
  };

  const handleInstall = () => {
    installMutation.mutate(extensionData);
  };

  const handleUninstall = () => {
    uninstallMutation.mutate(extensionData.id);
  };

  const handleToggleEnabled = () => {
    toggleEnabledMutation.mutate({ extensionId: extensionData.id, enabled: !extensionData.enabled });
  };

  const handleUpdate = () => {
    updateMutation.mutate(extensionData.id);
  };

  // Extract capabilities from extension data
  const capabilities = extensionData.capabilities || {};
  const features = extensionData.features || [];

  return (
    <div className="p-4  h-full w-full overflow-auto">
      <div className="bg-editor">
        {/* Header section */}
        <div className="border border-border  p-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl tracking-tight">{extensionData.name}</h1>
                {renderTypeIndicator()}
              </div>
              <div className="text-sm text-comment space-y-1">
                <p className="lowercase">author: {extensionData.author}</p>
                <p className="">version: {extensionData.version}</p>
              </div>
            </div>
            {extensionData.type === "community" ? (
              !extensionData.installedPath ? (
                <button
                  onClick={handleInstall}
                  className="px-2 py-1 bg-accent text-bg  text-sm border border-border rounded-sm flex items-center gap-2"
                >
                  {installMutation.isPending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Installing...
                    </>
                  ) : (
                    <>
                      <span className="text-orange-500">$</span> Install
                    </>
                  )}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={handleToggleEnabled} className="px-2 py-1 bg-accent text-bg text-sm border border-border rounded-sm">
                    {toggleEnabledMutation.isPending ? "..." : extensionData.enabled ? "Disable" : "Enable"}
                  </button>
                  <button onClick={handleUninstall} className="px-2 py-1 bg-accent text-bg text-sm border border-border rounded-sm">
                    Uninstall
                  </button>
                  {extensionData.latestVersion && (
                    <button onClick={handleUpdate} className="px-2 py-1 bg-accent text-bg text-sm border border-border rounded-sm flex items-center">
                      {updateMutation.isPending ? (
                        <>
                          <Loader2 size={14} className="animate-spin mr-1" />
                          Updating...
                        </>
                      ) : (
                        "Update"
                      )}
                    </button>
                  )}
                  {/* Conditionally render the error button */}
                  {error && (
                    <div className="flex items-center text-sm gap-1" style={{ color: 'var(--icon-error)' }}>
                      <button className="px-1 text-sm">Error</button>
                    </div>
                  )}
                </div>
              )
            ) : extensionData.type === "core" ? (
              <div className="flex items-center gap-2">
                {" "}
                {/* Added a wrapping div here */}
                <button onClick={handleToggleEnabled} className="px-2 py-1 bg-accent text-bg text-sm border border-border rounded-sm">
                  {toggleEnabledMutation.isPending ? "..." : extensionData.enabled ? "Disable" : "Enable"}
                </button>
                {/* Conditionally render the error button */}
                {error && (
                  <div className="flex items-center text-sm gap-1" style={{ color: 'var(--icon-error)' }}>
                    <button className="px-1 text-sm">Error</button>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <p className="mt-4 ">{extensionData.description}</p>

          {extensionData.type !== "core" && extensionData.repo && (
            <a
              onClick={() => {
                openExternalLink(`https://github.com/${extensionData.repo}`);
              }}
              className="mt-3 inline-flex items-center gap-2 text-sm text-accent hover:text-accent/80 cursor-pointer"
            >
              <GitBranch size={14} />
              View Source
            </a>
          )}
        </div>

        {/* Capabilities section */}
        {Object.keys(capabilities).length > 0 && (
          <div className="border-t border-border p-4">
            <h2 className="text-lg font-bold mb-4">Capabilities</h2>

            {/* Blocks */}
            {capabilities.blocks && (
              <div className="mb-6">
                <h3 className="text-base font-semibold mb-2">Blocks</h3>
                <p className="text-sm text-comment mb-2">{capabilities.blocks.description}</p>
                <div className="flex flex-wrap gap-2">
                  {capabilities.blocks.owns?.map((block: string) => (
                    <span key={block} className="px-2 py-1 bg-active rounded text-xs font-mono">
                      {block}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Slash Commands */}
            {capabilities.slashCommands && (
              <div className="mb-6">
                <h3 className="text-base font-semibold mb-2">Slash Commands</h3>
                {capabilities.slashCommands.groups?.map((group: any) => (
                  <div key={group.name} className="mb-3">
                    <p className="text-sm font-medium mb-1">{group.name}</p>
                    <ul className="list-disc list-inside space-y-1">
                      {group.commands?.map((cmd: string, idx: number) => (
                        <li key={idx} className="text-sm text-comment">{cmd}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* Paste Patterns */}
            {capabilities.paste && (
              <div className="mb-6">
                <h3 className="text-base font-semibold mb-2">Paste Handlers</h3>
                {capabilities.paste.patterns?.map((pattern: any) => (
                  <div key={pattern.name} className="mb-3 bg-bg p-3 rounded border border-border">
                    <p className="text-sm font-medium">{pattern.name}</p>
                    <p className="text-xs text-comment mt-1">{pattern.description}</p>
                    {pattern.handles && (
                      <p className="text-xs text-comment mt-1">Handles: {pattern.handles}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Editor Actions */}
            {capabilities.editorActions && (
              <div className="mb-6">
                <h3 className="text-base font-semibold mb-2">Editor Actions</h3>
                <p className="text-sm text-comment mb-2">{capabilities.editorActions.description}</p>
                {capabilities.editorActions.actions?.map((action: any) => (
                  <div key={action.id} className="mb-2 bg-bg p-3 rounded border border-border">
                    <p className="text-sm font-medium">{action.name}</p>
                    <p className="text-xs text-comment mt-1">{action.description}</p>
                    {action.fileTypes && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {action.fileTypes.map((ft: string) => (
                          <span key={ft} className="px-1.5 py-0.5 bg-active rounded text-xs font-mono">
                            {ft}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Request Pipeline */}
            {capabilities.requestPipeline && (
              <div className="mb-6">
                <h3 className="text-base font-semibold mb-2">Request Pipeline</h3>
                <p className="text-sm text-comment">{capabilities.requestPipeline.description}</p>
              </div>
            )}
          </div>
        )}

        {/* Features section */}
        {features.length > 0 && (
          <div className="border-t border-border p-4">
            <h2 className="text-lg font-bold mb-3">Features</h2>
            <ul className="list-disc list-inside space-y-1">
              {features.map((feature: string, idx: number) => (
                <li key={idx} className="text-sm text-comment">{feature}</li>
              ))}
            </ul>
          </div>
        )}

        {/* README section */}
        {content && (
          <div className="border-t border-border p-4">
            <h2 className="text-lg font-bold mb-3">Documentation</h2>
            <ReactMarkdown
              components={{
                // Override the default anchor tag rendering
                a: ({ href, children }) => <CustomLink href={href}>{children}</CustomLink>,
              }}
              className={`${proseClasses}`}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExtensionDetails;
