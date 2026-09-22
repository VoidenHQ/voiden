import { cn } from "@/core/lib/utils";
import { Command } from "cmdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { MinusculeMatcher, MatchingMode } from "@voiden/fuzzy-search";
import { highlightText } from "@/core/editors/voiden/extensions/MatchedFragment";
import { useQueryClient } from "@tanstack/react-query";
import { useEnvironments, useSetActiveEnvironment, useProfiles, useProfileFiles, useSetActiveProfile, useNestedEnvSources } from "@/core/environment/hooks";
import { useAddPanelTab, useActivateTab, useGetPanelTabs } from "@/core/layout/hooks";
import { useGetProjects } from "@/core/projects/hooks";
import { ChevronRight, FileText, Ban, Check, Settings2, Layers, FolderOpen } from "lucide-react";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";
import { matchesShortcut, getShortcutLabel } from "@/core/shortcuts";

export const EnvSelector = () => {
  const queryClient = useQueryClient();
  const { data: envs } = useEnvironments();
  const { data: profiles } = useProfiles();
  const { data: profileFiles } = useProfileFiles();
  const { data: nestedSources } = useNestedEnvSources();
  const { data: projects } = useGetProjects();
  const activeProject = projects?.activeProject as string | undefined;
  const { mutate: setActiveEnv } = useSetActiveEnvironment();
  const { mutate: setActiveProfile } = useSetActiveProfile();
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: activateTab } = useActivateTab();
  const { data: mainTabs } = useGetPanelTabs("main");
  const [open, setOpen] = useState(false);
  const hasMultipleProfiles = profiles && profiles.length > 1;
  const hasNestedProfiles = !!nestedSources && nestedSources.length > 0;
  const activeProfile = envs?.activeProfile || "default";

  // Which discovered nested-project profile is "selected" for viewing right
  // now — purely a local UI focus, not persisted state like the active
  // project's own profile (there's no backend concept of an "active"
  // profile for a folder you're not directly editing). Selecting one
  // check-marks it and narrows the Environment list below to just its envs;
  // selecting it again clears the narrowing.
  const [selectedNestedKey, setSelectedNestedKey] = useState<string | null>(null);
  const nestedKey = (projectPath: string, profile: string) => `${projectPath}::${profile}`;
  const selectedNestedSource = nestedSources?.find((s) => nestedKey(s.projectPath, s.profile) === selectedNestedKey) ?? null;

  useEffect(() => {
    if (open) {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      queryClient.invalidateQueries({ queryKey: ["env-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["env-profile-files"] });
      queryClient.invalidateQueries({ queryKey: ["nested-env-sources"] });
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

  const matcherCache = useRef<{ key: string; matcher: MinusculeMatcher | null }>({ key: "", matcher: null });
  const getMatcher = useCallback((query: string) => {
    if (matcherCache.current.key !== query) {
      matcherCache.current = {
        key: query,
        matcher: query ? new MinusculeMatcher("* " + query, MatchingMode.IGNORE_CASE, "") : null,
      };
    }
    return matcherCache.current.matcher;
  }, []);

  const filter = useCallback(
    (value: string, query: string, keywords?: string[]): number => {
      const matcher = getMatcher(query);
      if (!matcher) return 1;
      const candidates = [value, ...(keywords ?? [])];
      let best = 0;
      for (const c of candidates) {
        const m = matcher.match(c);
        if (m) {
          const s = matcher.matchingDegree(c, false, m);
          if (s > best) best = s;
        }
      }
      return best;
    },
    [getMatcher]
  );

  const matchFragments = (text: string) => getMatcher(search)?.match(text) ?? undefined;

  // The active profile's YAML file, project-relative, as actually reported
  // by the backend (env:load's profileFile) — NOT guessed/hardcoded here.
  // A project can have its YAML env files at .voiden/env-public.yaml OR,
  // pre-migration, at the project root (env.ts's loadYamlEnvironment falls
  // back to that old location transparently), so this can't be assumed from
  // the profile name alone.
  const profileYamlPath = envs?.profileFile;

  // envs.data keys are either an absolute .env file path (legacy fallback —
  // relativize it to the project root so the subtitle reads like
  // ".voiden/env-private.yaml" instead of leaking the full filesystem path),
  // a dotted YAML environment node name (e.g. "staging.eu" — not a real
  // path at all; multiple environments live as nodes inside one shared
  // profileYamlPath, so that's what's shown instead), or a nested
  // sub-project's environment (envs.sourcePaths has its folder — never the
  // yaml filename — reported directly by the backend).
  const relativizeToProject = (fileName: string): string => {
    if (envs?.sourcePaths?.[fileName]) return envs.sourcePaths[fileName];
    if (activeProject) {
      const norm = fileName.replace(/\\/g, "/");
      const normRoot = activeProject.replace(/\\/g, "/").replace(/\/+$/, "");
      if (norm.startsWith(normRoot + "/")) return norm.slice(normRoot.length + 1);
    }
    return profileYamlPath ?? fileName;
  };

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
                filter={filter}
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
                    value={search}
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

                  {(hasMultipleProfiles || hasNestedProfiles) && (
                    <Command.Group heading={
                      <div className="flex items-center gap-1.5 px-1 pb-1 text-xs font-medium uppercase tracking-wider text-comment">
                        <Layers size={12} />
                        Profile
                      </div>
                    }>
                      {hasMultipleProfiles && profiles.map((profile) => {
                        const profilePath = profileFiles?.[profile];
                        // Same rule as the environment list below: only show
                        // the path line if it says something the name above
                        // it doesn't already.
                        const showPath = !!profilePath && profilePath !== profile;
                        return (
                          <Command.Item
                            key={`profile-${profile}`}
                            value={`profile:${profile}`}
                            keywords={["profile", profile]}
                            className="cursor-pointer px-3 py-2 rounded-md mb-1 text-text data-[selected=true]:bg-active hover:bg-active flex items-center gap-3 outline-none"
                            onSelect={() => {
                              setActiveProfile(profile);
                              setSelectedNestedKey(null);
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium">{highlightText(profile, matchFragments(profile))}</div>
                              {showPath && (
                                <div className="text-xs text-comment truncate">{highlightText(profilePath, matchFragments(profilePath))}</div>
                              )}
                            </div>
                            {profile === activeProfile && (
                              <Check size={16} className="flex-shrink-0" style={{ color: 'var(--icon-success)' }} />
                            )}
                          </Command.Item>
                        );
                      })}
                      {/* Profiles of nested sub-projects (see useNestedEnvSources) —
                          a folder can have more than one, e.g. a legacy root-level
                          profile alongside its own .voiden/ default profile. There's
                          no persisted "active" state for these (all their
                          environments are always merged into the list below
                          regardless), so this is local UI selection only:
                          check-marks the row and narrows the Environment list to
                          just that folder/profile; selecting it again clears it. */}
                      {hasNestedProfiles && nestedSources.map((src) => {
                        const label = src.profile === "default" ? src.relPath : `${src.relPath} · ${src.profile}`;
                        const key = nestedKey(src.projectPath, src.profile);
                        const isSelected = selectedNestedKey === key;
                        return (
                          <Command.Item
                            key={`nested-profile-${src.projectPath}-${src.profile}`}
                            value={`nested-profile:${src.projectPath}:${src.profile}`}
                            keywords={[src.relPath, src.profile]}
                            className="cursor-pointer px-3 py-2 rounded-md mb-1 text-text data-[selected=true]:bg-active hover:bg-active flex items-center gap-3 outline-none"
                            onSelect={() => setSelectedNestedKey(isSelected ? null : key)}
                          >
                            <FolderOpen size={14} className="flex-shrink-0 text-comment" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{highlightText(label, matchFragments(label))}</div>
                              <div className="text-xs text-comment truncate">Other project in this workspace</div>
                            </div>
                            {isSelected && (
                              <Check size={16} className="flex-shrink-0" style={{ color: 'var(--icon-success)' }} />
                            )}
                          </Command.Item>
                        );
                      })}
                    </Command.Group>
                  )}

                  <Command.Group heading={(hasMultipleProfiles || hasNestedProfiles) ?
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

                    {/* Render available environments — narrowed to just the
                        selected nested profile's envs when one is checked above. */}
                    {envs?.data &&
                      Object.entries(envs.data)
                        .filter(([fileName]) =>
                          !selectedNestedSource ||
                          (envs.sourcePaths?.[fileName] === selectedNestedSource.relPath &&
                            envs.sourceProfiles?.[fileName] === selectedNestedSource.profile)
                        )
                        .map(([fileName]) => {
                        const customName = envs.displayNames?.[fileName];
                        const fallbackName = fileName.replace(/\\/g, "/").split("/").pop() || fileName;
                        const displayName = customName || fallbackName;
                        const relativePath = relativizeToProject(fileName);
                        return { fileName, displayName, fallbackName, relativePath, hasCustomName: !!customName };
                      }).map(({ fileName, displayName, fallbackName, relativePath, hasCustomName }) => {
                        const isActive = fileName === envs.activeEnv;
                        // Only worth its own line if it says something the
                        // display name doesn't already — e.g. skip it for a
                        // single root-level .env with no custom name, where
                        // both would just read ".env" twice.
                        const showPath = relativePath !== displayName;

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
                              <div className="text-sm font-medium truncate">{highlightText(displayName, matchFragments(displayName))}</div>
                              {showPath && (
                                <div className="text-xs text-comment truncate">{highlightText(relativePath, matchFragments(relativePath))}</div>
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
                <div className="px-4 py-2.5 border-t border-border bg-editor/50">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={handleOpenEditor}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-accent bg-accent text-text hover:bg-accent/80 transition-colors"
                      style={{ color: "var(--ui-bg)" }}
                    >
                      <Settings2 size={14} />
                      Edit Environments
                    </button>
                    <span className="flex items-center gap-1.5 text-comment">
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
