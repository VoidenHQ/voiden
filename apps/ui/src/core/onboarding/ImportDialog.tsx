import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/core/components/ui/dialog";
import { toast } from "@/core/components/ui/sonner";
import { cn } from "@/core/lib/utils";
import { importCurlAsNewTab } from "@/plugins";
import { addEnvVariables, resolveEnvTarget } from "./envTree";
import { parseCurl, planEnv, rewriteCurl, type EnvPlan } from "./curlPreview";

export type ImportSource = "postman" | "openapi" | "insomnia" | "bruno" | "har" | "curl";

const SOURCES: { id: ImportSource; name: string; detail: string; extensions?: string[] }[] = [
  { id: "postman", name: "Postman", detail: "Collection v2.1 + envs", extensions: ["json"] },
  { id: "openapi", name: "OpenAPI", detail: "3.x, Swagger 2", extensions: ["json", "yaml", "yml"] },
  { id: "insomnia", name: "Insomnia", detail: "Export v4 / v5", extensions: ["json", "yaml", "yml"] },
  { id: "bruno", name: "Bruno", detail: "Collection export", extensions: ["json", "yaml", "yml"] },
  { id: "har", name: "HAR", detail: "From browser DevTools", extensions: ["har", "json"] },
  { id: "curl", name: "curl", detail: "Paste on the right" },
];

export const SAMPLE_CURL = `curl -X POST https://api.example.com/v1/users \\
  -H 'Authorization: Bearer sk_live_51Hx9' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Ada","role":"admin"}'`;

const baseName = (p: string) => p.replace(/\\/g, "/").split("/").pop() || p;

/** A folder name for the project an import lands in: "petstore.yaml" → "petstore", "api.example.com" → "example". */
export function importProjectName(source: string) {
  const host = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(source) && !/\.(json|ya?ml|har)$/i.test(source);
  const parts = source.split(".");
  const raw = host ? parts[Math.max(0, parts.length - 2)] : parts.length > 1 ? parts.slice(0, -1).join(".") : source;
  return raw
    .replace(/[._-](postman_collection|postman_environment|insomnia|bruno|openapi|swagger)$/i, "")
    .toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "imported-api";
}

// ── dialog ──

export function ImportDialog({
  open,
  onOpenChange,
  initialCurl,
  initialSource = "curl",
  ensureProject,
  onOpened,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCurl?: string;
  initialSource?: ImportSource;
  /** Creates and opens a new project, named after what's being imported, and returns its path. */
  ensureProject: (name: string) => Promise<string>;
  /** Called after a file or request has been opened in the editor. */
  onOpened?: () => void;
}) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState<ImportSource>(initialSource);
  const [curl, setCurl] = useState(initialCurl || SAMPLE_CURL);
  const [useVariables, setUseVariables] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSource(initialSource);
    setCurl(initialCurl || SAMPLE_CURL);
  }, [open, initialCurl, initialSource]);

  // Imports always go into a new, empty project, so preview against an empty environment.
  const parsed = useMemo(() => parseCurl(curl), [curl]);
  const plan = useMemo(() => ("error" in parsed ? null : planEnv(parsed, resolveEnvTarget(undefined, undefined))), [parsed]);
  const projectName = "error" in parsed ? null : importProjectName(parsed.host);

  const openFile = async (filePath: string) => {
    setBusy(true);
    try {
      await ensureProject(importProjectName(baseName(filePath)));
      await window.electron?.ipc?.invoke("fileLink:open", filePath, baseName(filePath));
      await queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
      await queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
      onOpenChange(false);
      onOpened?.();
      toast.success(`Opened ${baseName(filePath)}`, {
        description: "Use the Import button in the editor toolbar to turn it into .void files.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open that file");
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async () => {
    const tile = SOURCES.find((s) => s.id === source);
    const extensions = tile?.extensions ?? ["json", "yaml", "yml", "har"];
    const [file] = (await window.electron?.dialog.openFile({ properties: ["openFile"], filters: [{ name: tile?.name ?? "API files", extensions }] })) ?? [];
    if (file) await openFile(file);
  };

  const createFromCurl = async () => {
    if ("error" in parsed || !plan) return;
    setBusy(true);
    try {
      await ensureProject(importProjectName(parsed.host));
      let finalCurl = curl;
      if (useVariables) {
        // Re-plan against the new project's actual environment files.
        let p: EnvPlan | null = null;
        await addEnvVariables((target) => {
          p = planEnv(parsed, target);
          return {
            publicVars: { [p.baseUrlVar]: parsed.origin },
            privateVars: Object.fromEntries(p.secretVars.map((s) => [s.name, s.secret.value])),
          };
        });
        if (p) finalCurl = rewriteCurl(curl, parsed, p);
      }
      await importCurlAsNewTab(parsed.title, finalCurl);
      onOpenChange(false);
      onOpened?.();
      toast.success(`Created ${parsed.title}.void`, {
        description: useVariables && plan.secretVars.length ? "The secret is in git-ignored env-private.yaml." : undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the request");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const filePath = window.electron?.utils.getPathForFile(file);
    if (filePath) openFile(filePath);
  };

  const methodColor =
    "error" in parsed
      ? ""
      : ({ GET: "text-emerald-400", POST: "text-accent", PUT: "text-blue-400", PATCH: "text-blue-400", DELETE: "text-red-400" } as Record<string, string>)[parsed.method] ?? "text-text";
  const sourceName = SOURCES.find((s) => s.id === source)?.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <div className="fixed inset-0 z-40" style={{ backgroundColor: "var(--ui-overlay-bg, rgba(0, 0, 0, 0.5))" }} />}
      <DialogContent className="max-w-[900px] w-[95%] p-0 bg-panel border border-border overflow-hidden text-text" datatype="no-close">
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-2">
          <div className="flex flex-col gap-1.5">
            <DialogTitle className="text-[22px] font-semibold">Bring your APIs</DialogTitle>
            <DialogDescription className="text-sm text-comment">
              Everything becomes plain .void files in your project. Your originals aren't changed.
            </DialogDescription>
          </div>
          <button type="button" aria-label="Close" onClick={() => onOpenChange(false)} className="p-2 rounded-md text-comment hover:text-text hover:bg-hover">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-wrap gap-5 px-7 pt-4 pb-6">
          <div className="flex-[1_1_340px] min-w-0 flex flex-col gap-3.5">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                "flex flex-col items-center justify-center gap-2 h-[168px] px-5 rounded-xl border-[1.5px] border-dashed text-center transition-colors",
                dragOver ? "border-accent bg-surface" : "border-border bg-bg",
              )}
            >
              <Upload size={28} className="text-blue-400" />
              <span className="text-sm font-medium">Drop a collection, spec or HAR file here</span>
              <span className="text-xs text-comment">
                or{" "}
                <button type="button" className="text-accent hover:underline" onClick={chooseFile} disabled={busy}>
                  choose a file
                </button>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Source">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={source === s.id}
                  onClick={() => setSource(s.id)}
                  className={cn(
                    "flex flex-col gap-1 p-3 rounded-lg border text-left",
                    source === s.id ? "border-accent/60 bg-surface" : "border-border bg-bg hover:bg-hover",
                  )}
                >
                  <span className="text-sm font-semibold">{s.name}</span>
                  <span className="text-[11px] text-comment">{s.detail}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-[1_1_340px] min-w-0 flex flex-col gap-2.5">
            {source === "curl" ? (
              <>
                <div className="flex items-center justify-between">
                  <label htmlFor="import-curl" className="text-xs font-medium text-comment">
                    Paste a curl command
                  </label>
                  <button type="button" className="text-xs text-accent hover:underline" onClick={() => setCurl(SAMPLE_CURL)}>
                    Reset example
                  </button>
                </div>
                <textarea
                  id="import-curl"
                  spellCheck={false}
                  rows={5}
                  value={curl}
                  onChange={(e) => setCurl(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      createFromCurl();
                    }
                  }}
                  className="w-full min-h-[130px] resize-y px-3.5 py-3 rounded-lg border border-border bg-bg font-mono text-xs leading-relaxed text-text outline-none focus:border-accent"
                />
                {"error" in parsed ? (
                  <div className="px-3 py-2.5 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-300">{parsed.error}</div>
                ) : (
                  <div className="flex flex-col gap-2.5 p-3.5 rounded-lg border border-border bg-bg">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-comment">Will create</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={cn("font-mono font-medium", methodColor)}>{parsed.method}</span>
                      <span className="font-mono break-all">{parsed.path}</span>
                      <span className="text-comment">→</span>
                      <span className="font-mono text-comment">{parsed.title}.void</span>
                    </span>
                    {parsed.chips.length > 0 && (
                      <span className="flex flex-wrap gap-1.5">
                        {parsed.chips.map((c) => (
                          <span key={c} className="text-[11px] px-2 py-0.5 rounded-md border border-border bg-panel">
                            {c}
                          </span>
                        ))}
                      </span>
                    )}
                    <label className="flex items-start gap-2 text-xs text-comment cursor-pointer">
                      <input type="checkbox" checked={useVariables} onChange={(e) => setUseVariables(e.target.checked)} className="mt-0.5 accent-[rgb(var(--common-accent))]" />
                      <span>
                        Host <span className="font-mono text-text">{parsed.host}</span> becomes{" "}
                        <span className="font-mono text-emerald-400">{`{{${plan?.baseUrlVar ?? "baseUrl"}}}`}</span> in env-public.yaml
                        {plan ? ` (${plan.envLabel} environment)` : ""}.
                      </span>
                    </label>
                    {useVariables && plan && plan.secretVars.length > 0 && (
                      <span className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-accent/30 bg-accent/10 text-xs leading-relaxed">
                        <Lock size={15} className="shrink-0 mt-px text-accent" />
                        <span>
                          We found {plan.secretVars.length > 1 ? `${plan.secretVars.length} secrets` : "a secret"}.{" "}
                          {plan.secretVars.length > 1 ? "They'll" : "It'll"} be moved to <span className="font-mono">env-private.yaml</span> as{" "}
                          {plan.secretVars.map((s, i) => (
                            <span key={s.name}>
                              {i > 0 && ", "}
                              <span className="font-mono">{`{{${s.name}}}`}</span>
                            </span>
                          ))}
                          , which is git-ignored, so it never lands in a commit.
                        </span>
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-2.5 p-3.5 rounded-lg border border-border bg-bg">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-comment">Waiting for a file</span>
                <span className="text-sm text-comment">
                  Drop a {sourceName} file on the left, or{" "}
                  <button type="button" className="text-accent hover:underline" onClick={chooseFile} disabled={busy}>
                    choose one
                  </button>
                  . It opens in Voiden with an Import button that converts it into .void files.
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-7 py-4 border-t border-border bg-bg">
          <span className="text-xs text-comment">
            Into a new project{" "}
            <span className="font-mono text-text">{source === "curl" ? (projectName ?? "…") : `named after the ${sourceName} file`}</span>
          </span>
          <span className="flex-1" />
          <button type="button" onClick={() => onOpenChange(false)} className="h-10 px-4 rounded-lg border border-border text-sm hover:bg-hover">
            Cancel
          </button>
          {source === "curl" ? (
            <button
              type="button"
              onClick={createFromCurl}
              disabled={busy || "error" in parsed}
              className="h-10 px-4 rounded-lg bg-button-primary hover:bg-button-primary-hover text-bg text-sm font-semibold disabled:opacity-50"
            >
              {"error" in parsed ? "Create file" : `Create ${parsed.title}.void and open it`}
            </button>
          ) : (
            <button
              type="button"
              onClick={chooseFile}
              disabled={busy}
              className="h-10 px-4 rounded-lg bg-button-primary hover:bg-button-primary-hover text-bg text-sm font-semibold disabled:opacity-50"
            >
              Choose {sourceName} file
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
