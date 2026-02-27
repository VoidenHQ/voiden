import { cn } from "@/core/lib/utils";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useGetProjects, useSetActiveProject, removeProjectFromList } from "@/core/projects/hooks";
import { X, Folder, Check } from "lucide-react";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";

const SHORTCUT_KEYS = "⌥⌘O";

export const RecentProjectsSelector = () => {
  const { data: projects, refetch } = useGetProjects();
  const setActiveProject = useSetActiveProject();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isMac = navigator.userAgent ? navigator.userAgent.toLowerCase().includes("mac") : true;

    const down = (e: KeyboardEvent) => {
      const isToggleShortcut = e.code === "KeyO" && ((isMac && e.metaKey && e.altKey) || (!isMac && e.ctrlKey && e.altKey));

      if (isToggleShortcut) {
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

  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  const handleProjectSelect = (projectPath: string) => {
    setActiveProject.mutate(projectPath);
    setOpen(false);
  };

  const handleProjectRemove = async (projectPath: string) => {
    await removeProjectFromList(projectPath);
    refetch();
  };
  const [search, setSearch] = useState("");

  if (!projects) return null;
  return (
    <>
      <Tip label={<span className="flex items-center gap-2"><span>Open recent project</span><Kbd keys={SHORTCUT_KEYS} size="sm" /></span>}>
        <button
          className={cn(
            "text-sm h-full px-2 flex items-center gap-2 hover:bg-active no-drag text-comment",
            !projects?.activeProject && "text-stone-400",
          )}
          onClick={() => setOpen(true)}
        >
          <span>{(projects?.activeProject || "").replace(/\\/g, "/")?.split("/").pop() || "Open recent project"}</span>
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
                       return projectName.toLowerCase().includes(search.toLowerCase());
                    }).map((project: string) => {
                      const isActive = projects?.activeProject === project;
                      const normalizedPath = project.replace(/\\/g, "/");
                      const projectName = normalizedPath.split("/").pop();

                      return (
                        <Command.Item
                          key={project}
                          value={projectName}
                          className="cursor-pointer px-3 py-2.5 rounded-md mb-1 text-text data-[selected=true]:bg-active hover:bg-active flex items-center gap-3 outline-none group"
                          onSelect={() => handleProjectSelect(project)}
                        >
                          <Folder size={16} className="flex-shrink-0 text-comment" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{projectName}</div>
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
                      <Kbd keys={SHORTCUT_KEYS} size="sm" />
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
