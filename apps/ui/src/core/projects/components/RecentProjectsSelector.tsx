import { cn } from "@/core/lib/utils";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useGetProjects, useSetActiveProject, removeProjectFromList } from "@/core/projects/hooks";
import { X, Folder, Check, Puzzle } from "lucide-react";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";
import { matchesShortcut, getShortcutLabel } from "@/core/shortcuts";

export const RecentProjectsSelector = () => {
  const { data: projects, refetch } = useGetProjects();
  const setActiveProject = useSetActiveProject();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const closeModal = () => {
    setOpen(false);
    setSearch("");
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (matchesShortcut("ToggleRecentProjectsSelector", e)) {
        e.preventDefault();
        setOpen((prev) => { if (prev) setSearch(""); return !prev; });
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open]);

  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  const handleProjectSelect = (projectPath: string) => {
    setActiveProject.mutate(projectPath);
    closeModal();
  };

  const handleProjectRemove = async (projectPath: string) => {
    await removeProjectFromList(projectPath);
    refetch();
  };

  if (!projects) return null;

  // Recent projects that are plugin projects (manifest.json + build script), keyed by path.
  const pluginProjects: Record<string, { pluginId?: string; pluginName?: string }> = projects.pluginProjects ?? {};
  const isActivePlugin = !!projects.activeProject && !!pluginProjects[projects.activeProject];
  return (
    <>
      <Tip label={<span className="flex items-center gap-2"><span>Open recent project</span><Kbd keys={getShortcutLabel("ToggleRecentProjectsSelector")} size="sm" /></span>}>
        <button
          className={cn(
            "text-sm h-full px-2 flex items-center gap-2 hover:bg-active no-drag text-comment",
            !projects?.activeProject && "text-stone-400",
          )}
          onClick={() => setOpen(true)}
        >
          {isActivePlugin && <Puzzle size={12} className="text-accent flex-shrink-0" />}
          <span>{(projects?.activeProject || "").replace(/\\/g, "/")?.split("/").pop() || "Open recent project"}</span>
        </button>
      </Tip>

      {
        open && (
          <div
            className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh] bg-black/50"
            onClick={closeModal}
          >
            <div className="w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>

              <Command
                label="Recent Projects"
                className="bg-editor border border-border rounded-lg shadow-lg overflow-hidden"
              >

                {/* Header */}
                <div className="px-4 py-3 border-b border-border">
                  <span className="flex">
                    <h2 className="text-base font-semibold text-text">Recent Projects</h2>
                    <span className="text-xs text-comment ml-auto">ESC to close</span>
                  </span>
                  <p className="text-xs text-comment mt-0.5">Open a recent project or browse for a new one</p>
                </div>

                {/* Search Input */}
                <div className="px-3 py-2 border-b border-border">
                  <Command.Input
                    className="w-full border-none h-8 px-2 text-sm bg-editor rounded text-text outline-none placeholder:text-comment"
                    placeholder="Search recent projects..."
                    onValueChange={setSearch}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                    autoFocus
                  />
                </div>

                {/* List */}
                <Command.List className="max-h-[400px] overflow-y-auto p-2">
                  <Command.Empty className="px-3 py-8 text-center text-comment text-sm">No matches</Command.Empty>
                  <Command.Group>
                    {projects?.projects.filter((project:string)=>{
                       const normalizedPath = project.replace(/\\/g, "/");
                       const projectName = normalizedPath.split("/").pop()||normalizedPath;
                       const plugin = pluginProjects[project];
                       // Plugin projects also match their plugin name and the word "plugin".
                       const haystack = plugin ? `${projectName} ${plugin.pluginName ?? ""} plugin` : projectName;
                       return haystack.toLowerCase().includes(search.toLowerCase());
                    }).map((project: string) => {
                      const isActive = projects?.activeProject === project;
                      const normalizedPath = project.replace(/\\/g, "/");
                      const projectName = normalizedPath.split("/").pop();
                      const plugin = pluginProjects[project];

                      return (
                        <Command.Item
                          key={project}
                          value={plugin ? `${projectName} ${plugin.pluginName ?? ""} plugin` : projectName}
                          className="cursor-pointer px-3 py-2.5 rounded-md mb-1 text-text data-[selected=true]:bg-active hover:bg-active flex items-center gap-3 outline-none group"
                          onSelect={() => handleProjectSelect(project)}
                        >
                          {plugin ? (
                            <Puzzle size={16} className="flex-shrink-0 text-accent" />
                          ) : (
                            <Folder size={16} className="flex-shrink-0 text-comment" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium truncate">{projectName}</span>
                              {plugin && (
                                <span
                                  className="flex-shrink-0 px-1.5 py-px rounded text-[10px] font-medium leading-4 text-accent border border-accent/30 bg-accent/10"
                                  title={plugin.pluginName ? `Plugin: ${plugin.pluginName}` : "Plugin project"}
                                >
                                  Plugin
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-comment truncate">{project}</div>
                          </div>
                          {isActive && <Check size={16} className="flex-shrink-0 text-green-500" />}
                          <div
                            className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-editor transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleProjectRemove(project);
                            }}
                          >
                            <X size={14} className="text-comment" />
                          </div>
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                </Command.List>

                {/* Footer */}
                <div className="px-4 py-2 border-t border-border bg-editor/50">
                  <div className="flex items-center justify-between text-comment">
                    <span className="text-xs">Use ↑↓ to navigate • Enter to select</span>
                    <span className="flex items-center gap-1.5">
                      <Kbd keys={getShortcutLabel("ToggleRecentProjectsSelector")} size="sm" />
                      <span className="text-xs">to toggle</span>
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
