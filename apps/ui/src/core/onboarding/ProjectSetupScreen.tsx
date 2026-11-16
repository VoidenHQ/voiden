import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import YAML from "yaml";
import { toast } from "@/core/components/ui/sonner";
import { cn } from "@/core/lib/utils";
import { useGetProjects } from "@/core/projects/hooks";
import { useClosePanelTab } from "@/core/layout/hooks";
import { addEnvVariables } from "./envTree";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];
const SECRET_KEY = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|_KEY$|^KEY$|API_?KEY)/i;
const METHOD_COLOR: Record<string, string> = {
  GET: "text-emerald-400",
  POST: "text-accent",
  PUT: "text-blue-400",
  PATCH: "text-blue-400",
  DELETE: "text-red-400",
};

const rel = (root: string, p: string) => {
  const r = root.replace(/\\/g, "/").replace(/\/$/, "");
  const n = p.replace(/\\/g, "/");
  return n.startsWith(r + "/") ? n.slice(r.length + 1) : n;
};

type SpecInfo = { path: string; title?: string; ops: { method: string; path: string }[]; groups: number };
type EnvInfo = { path: string; vars: { key: string; value: string; secret: boolean }[] };

function readSpec(path: string, raw: string): SpecInfo {
  try {
    const doc = YAML.parse(raw);
    const ops: SpecInfo["ops"] = [];
    const tags = new Set<string>();
    for (const [p, item] of Object.entries<any>(doc?.paths ?? {})) {
      for (const m of HTTP_METHODS) {
        if (!item?.[m]) continue;
        ops.push({ method: m.toUpperCase(), path: p });
        tags.add(item[m]?.tags?.[0] ?? "untagged");
      }
    }
    return { path, title: doc?.info?.title, ops, groups: tags.size };
  } catch {
    return { path, ops: [], groups: 0 };
  }
}

function readEnvTemplate(path: string, raw: string): EnvInfo {
  const vars: EnvInfo["vars"] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].replace(/\s+#.*$/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
    vars.push({ key: m[1], value, secret: SECRET_KEY.test(m[1]) });
  }
  return { path, vars };
}

/** "This repo has an API" — offered after opening a folder that has no .void files yet. */
export default function ProjectSetupScreen({ tabId }: { tabId: string }) {
  const queryClient = useQueryClient();
  const { data: projects } = useGetProjects();
  const { mutate: closeTab } = useClosePanelTab();
  const root: string | undefined = projects?.activeProject;
  const name = root?.replace(/\\/g, "/").split("/").pop() ?? "this project";

  const { data, isLoading } = useQuery({
    queryKey: ["onboarding:project-setup", root],
    enabled: !!root,
    queryFn: async () => {
      const scan = await window.electron!.files.scanProjectSetup(root!);
      const specs = await Promise.all(scan.specs.map(async (p) => readSpec(p, (await window.electron?.files.read(p)) ?? "")));
      const envs = await Promise.all(scan.envFiles.map(async (p) => readEnvTemplate(p, (await window.electron?.files.read(p)) ?? "")));
      return { specs, envs: envs.filter((e) => e.vars.length) };
    },
  });

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, boolean> = {};
    data.specs.forEach((s, i) => (next[s.path] = i === 0));
    data.envs.forEach((e, i) => (next[e.path] = i === 0));
    setPicked(next);
  }, [data]);

  const chosenSpecs = useMemo(() => data?.specs.filter((s) => picked[s.path]) ?? [], [data, picked]);
  const chosenEnvs = useMemo(() => data?.envs.filter((e) => picked[e.path]) ?? [], [data, picked]);
  const nothing = !chosenSpecs.length && !chosenEnvs.length;

  const close = () => closeTab({ panelId: "main", tabId });

  const setUp = async () => {
    if (!root || nothing) return;
    setBusy(true);
    try {
      if (chosenEnvs.length) {
        const vars = chosenEnvs.flatMap((e) => e.vars);
        await addEnvVariables(() => ({
          publicVars: Object.fromEntries(vars.filter((v) => !v.secret).map((v) => [v.key, v.value])),
          // Secrets start empty: a template's values are placeholders, not real credentials.
          privateVars: Object.fromEntries(vars.filter((v) => v.secret).map((v) => [v.key, ""])),
        }));
      }
      for (const spec of chosenSpecs) {
        await window.electron?.ipc?.invoke("fileLink:open", spec.path, spec.path.replace(/\\/g, "/").split("/").pop());
      }
      close();
      await queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
      toast.success("Project set up", {
        description: [
          chosenEnvs.length && "Variables added to .voiden/env-public.yaml and env-private.yaml.",
          chosenSpecs.length && "Use the Import button on the spec to generate .void requests.",
        ]
          .filter(Boolean)
          .join(" "),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel = nothing
    ? "Nothing selected"
    : [chosenEnvs.length && "Add environment variables", chosenSpecs.length && `open ${chosenSpecs.length > 1 ? `${chosenSpecs.length} specs` : "the spec"}`]
        .filter(Boolean)
        .join(" and ")
        .replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="h-full bg-editor overflow-auto text-text select-text">
      <div className="flex justify-center px-8 py-9">
        <div className="w-full max-w-[760px] flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-2xl font-semibold">This repo has an API. Want requests for it?</h1>
            <p className="m-0 text-sm leading-relaxed text-comment">
              <span className="font-mono text-text">{name}</span> has no .void files yet, but it has the files below. Pick what to bring in. Environment
              variables go to <span className="font-mono text-text">.voiden/</span>, so you can review them in the Git diff before committing.
            </p>
          </div>

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-comment">
              <Loader2 size={14} className="animate-spin" /> Looking through {name}…
            </div>
          )}

          {data?.specs.map((spec) => {
            const on = !!picked[spec.path];
            const showAll = !!expanded[spec.path];
            const ops = showAll ? spec.ops : spec.ops.slice(0, 4);
            return (
              <div key={spec.path} className={cn("rounded-xl border border-border bg-panel overflow-hidden", !on && "opacity-60")}>
                <label className="flex items-center gap-3 px-4 py-3.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setPicked((p) => ({ ...p, [spec.path]: e.target.checked }))}
                    className="w-4 h-4 accent-[rgb(var(--common-accent))]"
                  />
                  <span className="flex-1 flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">
                      <span className="font-mono">{rel(root!, spec.path)}</span>
                      {spec.ops.length > 0 && `: ${spec.ops.length} endpoint${spec.ops.length > 1 ? "s" : ""} in ${spec.groups} group${spec.groups > 1 ? "s" : ""}`}
                    </span>
                    <span className="text-xs text-comment">
                      {spec.title ? `${spec.title}. ` : ""}Opens the spec as-is; its Import button turns endpoints into runnable requests.
                    </span>
                  </span>
                </label>
                {ops.map((op) => (
                  <div key={`${op.method} ${op.path}`} className="flex items-center gap-2.5 h-[34px] px-4 border-t border-border text-sm">
                    <span className={cn("w-14 font-mono", METHOD_COLOR[op.method] ?? "text-comment")}>{op.method}</span>
                    <span className="flex-1 truncate font-mono text-comment">{op.path}</span>
                  </div>
                ))}
                {spec.ops.length > 4 && (
                  <div className="flex items-center h-[34px] px-4 border-t border-border">
                    <button type="button" className="text-sm text-accent hover:underline" onClick={() => setExpanded((x) => ({ ...x, [spec.path]: !showAll }))}>
                      {showAll ? "Show less" : `+ ${spec.ops.length - 4} more endpoints`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {data?.envs.map((env) => {
            const on = !!picked[env.path];
            const pub = env.vars.filter((v) => !v.secret);
            const sec = env.vars.filter((v) => v.secret);
            return (
              <div key={env.path} className={cn("rounded-xl border border-border bg-panel", !on && "opacity-60")}>
                <label className="flex items-center gap-3 px-4 py-3.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setPicked((p) => ({ ...p, [env.path]: e.target.checked }))}
                    className="w-4 h-4 accent-[rgb(var(--common-accent))]"
                  />
                  <span className="flex-1 flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">
                      <span className="font-mono">{rel(root!, env.path)}</span>: {env.vars.length} variable{env.vars.length > 1 ? "s" : ""}
                    </span>
                    <span className="text-xs text-comment">
                      {pub.length > 0 && (
                        <>
                          <span className="font-mono">{pub.slice(0, 2).map((v) => v.key).join(", ")}</span>
                          {pub.length > 2 && ` and ${pub.length - 2} more`} go to env-public.yaml.{" "}
                        </>
                      )}
                      {sec.length > 0 && (
                        <>
                          <span className="font-mono">{sec.slice(0, 2).map((v) => v.key).join(", ")}</span>
                          {sec.length > 2 && ` and ${sec.length - 2} more`} go to git-ignored env-private.yaml, empty for you to fill in.
                        </>
                      )}
                    </span>
                  </span>
                </label>
              </div>
            );
          })}

          {data && !data.specs.length && !data.envs.length && (
            <div className="p-4 rounded-lg border border-dashed border-border text-sm text-comment">
              No OpenAPI specs or .env templates found. Start empty and add requests with <span className="font-mono">/request</span>.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={setUp}
              disabled={busy || nothing}
              className="h-11 px-5 rounded-lg bg-button-primary hover:bg-button-primary-hover text-bg text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {primaryLabel}
            </button>
            <button type="button" onClick={close} className="h-11 px-5 rounded-lg border border-border text-sm hover:bg-hover">
              Start empty
            </button>
            <span className="text-xs text-comment">Run this again from the command palette: “Set up project from existing files”.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
