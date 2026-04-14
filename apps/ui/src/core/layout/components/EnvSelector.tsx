import { cn } from "@/core/lib/utils";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEnvironments, useSetActiveEnvironment, useProfiles, useSetActiveProfile } from "@/core/environment/hooks";
import { useAddPanelTab, useActivateTab, useGetPanelTabs } from "@/core/layout/hooks";
import { ChevronRight, FileText, Ban, Check, Settings2, Layers } from "lucide-react";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";
import { matchesShortcut, getShortcutLabel } from "@/core/shortcuts";

export const EnvSelector = () => {
  const queryClient = useQueryClient();
  const { data: envs } = useEnvironments();
  const { data: profiles } = useProfiles();
  const { mutate: setActiveEnv } = useSetActiveEnvironment();
  const { mutate: setActiveProfile } = useSetActiveProfile();
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: activateTab } = useActivateTab();
  const { data: mainTabs } = useGetPanelTabs("main");
  const [open, setOpen] = useState(false);
  const hasMultipleProfiles = profiles && profiles.length > 1;
  const activeProfile = envs?.activeProfile || "default";

  useEffect(() => {
    if (open) {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      queryClient.invalidateQueries({ queryKey: ["env-profiles"] });
    }
  }, [open, queryClient]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Don't trigger if focus is in a CodeMirror editor
      const target = e.target as HTMLElement;
      if (target?.closest('.cm-editor, .txt-editor')) {
        return;
      }

      // ⌥⌘E (Mac) or Alt+Ctrl+E (Windows/Linux) to toggle
      if (matchesShortcut("ToggleEnvSelector", e)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }

    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open]);

  const handleEnvSelect = (envPath: string) => {
    setActiveEnv(envPath);
    setOpen(false);
  };

  const handleOpenEditor = () => {
    setOpen(false);
    const existing = mainTabs?.tabs?.find((t: { type: string; id: string }) => t.type === "environmentEditor");
    if (existing) {
      activateTab({ panelId: "main", tabId: existing.id });
      return;
    }
    addPanelTab({
      panelId: "main",
      tab: { id: crypto.randomUUID(), type: "environmentEditor", title: "Environments", source: null },
    });
  };
  const [search, setSearch] = useState("");

  if (!envs) return null;
  return (
    <>
      <div className="px-1">
        <ChevronRight size={14} className="text-comment" />
      </div>
      <Tip label={<span className="flex items-center gap-2"><span>Select an environment</span><Kbd keys={getShortcutLabel("ToggleEnvSelector")} size="sm" /></span>}>
        <button
          className={cn("text-sm h-full px-2 flex items-center gap-2 hover:bg-active no-drag", !envs?.activeEnv && "text-comment")}
          onClick={() => setOpen(true)}
        >
          <span>
            {envs?.activeEnv
              ? (envs.displayNames?.[envs.activeEnv] || envs.activeEnv.replace(/\\/g, "/").split("/").pop())
              : "No environment"}
            {hasMultipleProfiles && activeProfile !== "default" && (
              <span className="text-comment ml-1">({activeProfile})</span>
            )}
          </span>
        </button>
      </Tip>
      {
        open && (
          <div
            className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh] bg-black/50"
            onClick={() => setOpen(false)}
          >
            <div className="w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>

              <Command
                label="Select Environment"
                className="bg-editor border border-border rounded-lg shadow-lg overflow-hidden"
              >
                {/* Header */}
                <div className="px-4 py-3 border-b border-border">
                  <span className="flex ">
                    <h2 className="text-base font-semibold text-text">Select Environment</h2>
                    <span className="text-xs text-comment ml-auto">ESC to close</span>
                  </span>
                  <p className="text-xs text-comment mt-0.5">Choose which environment variables to use</p>
                </div>

                {/* Search Input */}
                <div className="px-3 py-2 border-b border-border">
                  <Command.Input
                    className="w-full border-none h-8 px-2 text-sm bg-editor rounded text-text outline-none placeholder:text-comment"
                    placeholder="Search environments..."
                    onValueChange={setSearch}
                    onMouseDown={(e)=>{
                      e.stopPropagation()
                    }}
                    autoFocus
                  />
                </div>

                {/* Environment List */}
                <Command.List className="max-h-[400px] overflow-y-auto p-2">
                  <Command.Empty className="py-6 text-center text-comment text-sm">No environments found</Command.Empty>

                  {hasMultipleProfiles && (
                    <Command.Group heading={
                      <div className="flex items-center gap-1.5 px-1 pb-1 text-xs font-medium uppercase tracking-wider text-comment">
                        <Layers size={12} />
                        Profile
                      </div>
                    }>
                      {profiles.map((profile) => (
                        <Command.Item
                          key={`profile-${profile}`}
                          value={`profile:${profile}`}
                          keywords={["profile", profile]}
                          className="cursor-pointer px-3 py-2 rounded-md mb-1 text-text data-[selected=true]:bg-active hover:bg-active flex items-center gap-3 outline-none"
                          onSelect={() => {
                            setActiveProfile(profile);
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{profile}</div>
                          </div>
                          {profile === activeProfile && (
                            <Check size={16} className="flex-shrink-0" style={{ color: 'var(--icon-success)' }} />
                          )}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}

                  <Command.Group heading={hasMultipleProfiles ?
                    <div className="flex items-center gap-1.5 px-1 pb-1 text-xs font-medium uppercase tracking-wider text-comment">
                      <FileText size={12} />
                      Environment
                    </div> : undefined
                  }>
                    {/* Option to clear environment */}
                    <Command.Item
                      value="none"
                      keywords={["none", "clear", "disable", "no"]}
                      className="cursor-pointer px-3 py-2.5 rounded-md mb-1 text-text data-[selected=true]:bg-active hover:bg-active flex items-center gap-3 outline-none"
                      onSelect={() => handleEnvSelect("")}
                    >
                      <Ban size={16} className="text-comment flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">None</div>
                        <div className="text-xs text-comment">No environment variables</div>
                      </div>
                      {(!envs.activeEnv || envs.activeEnv === "") && (
                        <Check size={16} className="flex-shrink-0" style={{ color: 'var(--icon-success)' }} />
                      )}
                    </Command.Item>

                    {/* Render available environments */}
                    {envs?.data &&
                      Object.entries(envs.data).map(([fileName]) => {
                        const customName = envs.displayNames?.[fileName];
                        const fallbackName = fileName.replace(/\\/g, "/").split("/").pop() || fileName;
                        const displayName = customName || fallbackName;
                        return { fileName, displayName, fallbackName, hasCustomName: !!customName };
                      }).filter(({ displayName, fallbackName }) =>
                        displayName.toLowerCase().includes(search.toLowerCase()) ||
                        fallbackName.toLowerCase().includes(search.toLowerCase())
                      ).map(({ fileName, displayName, fallbackName, hasCustomName }) => {
                        const isActive = fileName === envs.activeEnv;

                        return (
                          <Command.Item
                            key={fileName}
                            value={fileName}
                            keywords={hasCustomName ? [fallbackName, displayName] : undefined}
                            className="cursor-pointer px-3 py-2.5 rounded-md mb-1 text-text data-[selected=true]:bg-active hover:bg-active flex items-center gap-3 outline-none"
                            onSelect={() => handleEnvSelect(fileName)}
                          >
                            <FileText size={16} className="flex-shrink-0" style={{ color: 'var(--icon-primary)' }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{displayName}</div>
                              {hasCustomName && (
                                <div className="text-xs text-comment truncate">{fileName}</div>
                              )}
                            </div>
                            {isActive && (
                              <Check size={16} className="flex-shrink-0" style={{ color: 'var(--icon-success)' }} />
                            )}
                          </Command.Item>
                        );
                      })}
                  </Command.Group>
                </Command.List>

                {/* Footer with keyboard hint */}
                <div className="px-4 py-2 border-t border-border bg-editor/50">
                  <div className="flex items-center justify-between text-comment">
                    <button
                      onClick={handleOpenEditor}
                      className="flex items-center gap-1.5 text-sm hover:text-text transition-colors"
                    >
                      <Settings2 size={14} />
                      Edit Environments & Profiles
                    </button>
                    <span className="flex items-center gap-1.5">
                      <Kbd keys={getShortcutLabel("ToggleEnvSelector")} size="sm" />
                      <span className="text-sm">to toggle</span>
                    </span>
                  </div>
                </div>
              </Command>
            </div>
          </div>
        )
      }

    </>
  );
};
