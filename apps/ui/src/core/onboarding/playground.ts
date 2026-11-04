import { getQueryClient } from "@/main";
import { setActiveProjectImperative } from "@/core/projects/hooks";
import { usePanelStore } from "@/core/stores/panelStore";

/** The tour's first file; a project with it at the root is a playground. */
export const PLAYGROUND_MARKER_FILE = "1-first-request.void";

const isPlayground = async (projectPath: string | undefined) =>
  !!projectPath && !!(await window.electron?.files.getFileExist(projectPath, PLAYGROUND_MARKER_FILE));

/**
 * Make the playground the active project and return its path. Reuses the active project or
 * any known one that's a playground (it may be named playground-1 and so on), and only creates
 * one in the default project directory when there's none yet.
 */
export async function openPlaygroundProject(): Promise<string> {
  const projects = await window.electron?.state.getProjects();
  if (await isPlayground(projects?.activeProject)) return projects!.activeProject;

  const settings = await window.electron?.userSettings?.get();
  const baseDir: string | undefined = settings?.projects?.default_directory;
  const preferred = baseDir ? await window.electron?.utils?.pathJoin(baseDir, "playground") : undefined;
  const known: string[] = projects?.projects ?? [];
  const candidates = preferred ? [preferred, ...known.filter((p) => p !== preferred)] : known;

  let projectPath: string | null = null;
  for (const p of candidates) {
    if (known.includes(p) && (await isPlayground(p))) {
      projectPath = p;
      break;
    }
  }
  if (!projectPath) {
    if (!baseDir) throw new Error("Set a default project directory in Settings first.");
    const result = await window.electron?.files.createPlayground(baseDir);
    if (!result?.projectPath) throw new Error("Couldn't create the playground project.");
    projectPath = result.projectPath;
  }

  // No environment is pre-selected: picking one is the tour's first step.
  await setActiveProjectImperative(projectPath);
  // The explorer may be collapsed (it starts that way on first launch); show the project.
  usePanelStore.getState().openLeftPanel();
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false }),
    queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false }),
  ]);
  return projectPath;
}
