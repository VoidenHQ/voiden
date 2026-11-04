import { getQueryClient } from "@/main";

/**
 * Open the "Set up <project>" tab for the active project. Without `force` it only opens when
 * the folder has no .void files yet but does have an OpenAPI spec or a .env template.
 */
export async function openProjectSetup({ force = false }: { force?: boolean } = {}): Promise<boolean> {
  const projects = await window.electron?.state.getProjects();
  const root: string | undefined = projects?.activeProject;
  if (!root) return false;

  if (!force) {
    const scan = await window.electron?.files.scanProjectSetup(root);
    if (!scan || scan.voidCount > 0 || (!scan.specs.length && !scan.envFiles.length)) return false;
  }

  const name = root.replace(/\\/g, "/").split("/").pop() || "project";
  const tabs = await window.electron?.state.getPanelTabs("main");
  const existing = tabs?.tabs?.find((t: any) => t.type === "projectSetup");
  const tabId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    await window.electron?.state.addPanelTab("main", { id: tabId, type: "projectSetup", title: `Set up ${name}`, source: null });
  }
  await window.electron?.state.activatePanelTab("main", tabId);

  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false }),
    queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false }),
    queryClient.invalidateQueries({ queryKey: ["onboarding:project-setup"] }),
  ]);
  return true;
}
