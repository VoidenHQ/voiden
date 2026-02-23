// src/openapi-import/components/OpenAPIImportPanel.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentTab, PluginContext } from "@voiden/sdk/ui";
import {ExtendedPluginContextExplicit} from '../plugin';
import {
  parseOpenAPI,
  openApiToNodes,
  type EndpointNode,
  type TagNode,
  type OpenAPIDocument,
  generateSelected,
  getFilesExists,
} from "../utils/converter";

type Props = { context: ExtendedPluginContextExplicit };
import "../openapi-plugin.css";
import { ArrowUp,ArrowDown, CircleX } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────────
// HTTP Method styling using theme variables
// ──────────────────────────────────────────────────────────────────────────────
const SWAGGER = {
  get: {
    rail: "bg-method-get text-white",
    box: "bg-method-get-light border border-method-get text-method-get rounded",
    method: "get"
  },
  post: {
    rail: "bg-method-post text-white",
    box: "bg-method-post-light border border-method-post text-method-post rounded",
    method: "post"
  },
  put: {
    rail: "bg-method-put text-white",
    box: "bg-method-put-light border border-method-put text-method-put rounded",
    method: "put"
  },
  delete: {
    rail: "bg-method-delete text-white",
    box: "bg-method-delete-light border border-method-delete text-method-delete rounded",
    method: "delete"
  },
  head: {
    rail: "bg-method-head text-white",
    box: "bg-method-head-light border border-method-head text-method-head rounded",
    method: "head"
  },
  patch: {
    rail: "bg-method-patch text-white",
    box: "bg-method-patch-light border border-method-patch text-method-patch rounded",
    method: "patch"
  },
  options: {
    rail: "bg-method-options text-white",
    box: "bg-method-options-light border border-method-options text-method-options rounded",
    method: "options"
  },
  trace: {
    rail: "bg-method-default text-white",
    box: "bg-method-default-light border border-method-default text-method-default rounded",
    method: "trace"
  },
  default: {
    rail: "bg-method-default text-white",
    box: "bg-method-default-light border border-method-default text-method-default rounded",
    method: "default"
  },
} as const;


const methodKey = (m?: string) => (m || "").toLowerCase() as keyof typeof SWAGGER;

// Little helpers
const StatusColor = (code: string) =>
  code.startsWith("2") ? "text-success" : code.startsWith("4") ? "text-warning" : code.startsWith("5") ? "text-error" : "text-fg";

const CodeBox: React.FC<{ value?: unknown; maxH?: number }> = ({ value, maxH = 224 }) => {
  if (value == null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="mt-1 border border-line rounded bg-editor p-2 text-xs overflow-auto text-fg" style={{ maxHeight: maxH }}>
      <code>{text}</code>
    </pre>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
export const OpenAPIImportPanel: React.FC<Props> = ({ context }) => {
  const [doc, setDoc] = useState<OpenAPIDocument | null>(null);
  const [nodes, setNodes] = useState<TagNode[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [foldedTags, setFoldedTags] = useState<Record<string, boolean>>({});

  const [busy, setBusy] = useState(false);
  const [activeProject, setActiveProject] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const [activeSource,setActiveSource] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);

  // read active editor
  const readActiveEditorText = useCallback(() => {
    try {
      const code = context.project.getActiveEditor?.("code");
      const voiden = context.project.getActiveEditor?.("voiden");
      const value =
        (code && typeof code.getText === "function" && code.getText()) || (voiden && typeof voiden.getText === "function" && voiden.getText()) || "";
      return value || "";
    } catch {
      return "";
    }
  }, [context]);

  const applyRaw = useCallback((text: string) => {
    if (!text?.trim()) {
      setDoc(null);
      setNodes([]);
      setErr(null);
      setSelected({});
      setExpanded({});
      setFoldedTags({});
      setIsLoading(false);
      return;
    }
    try {
      const parsed = parseOpenAPI(text);
      const parsedNodes = openApiToNodes(parsed);
      setDoc(parsed);
      setNodes(parsedNodes);
      setErr(null);
      setSelected({});
      setExpanded({});
      
      // Collapse all tags by default
      const initialFolded: Record<string, boolean> = {};
      parsedNodes.forEach((tag) => {
        initialFolded[tag.id] = true;
      });
      setFoldedTags(initialFolded);
      
      setIsLoading(false);
    } catch (e: any) {
      setDoc(null);
      setNodes([]);
      setErr(e?.message || "Failed to parse OpenAPI document");
      setIsLoading(false);
    }
  }, []);

  const toLower = (s?: string) => (s ?? "").toLowerCase();

  // if `query` is empty => no filtering; otherwise match against tag, path and endpoint fields
  const filteredNodes = useMemo(() => {
    const q = toLower(query).trim();
    if (!q) return nodes;

    const tagMatches = (label?: string) => toLower(label).includes(q);

    const epMatches = (ep: EndpointNode, pathLabel?: string, tagLabel?: string) => {
      const hay = [
        tagLabel,
        pathLabel,
        ep.method,
        ep.path,
        ep.summary,
        (ep as any).operationId,
        ...(Array.isArray((ep as any).tags) ? (ep as any).tags : []),
      ]
        .map(toLower)
        .join(" ");
      return hay.includes(q);
    };

    // keep structure, prune non-matching children
    const next = nodes
      .map((tag) => {
        const prunedPaths = tag.children
          .map((path) => {
            const eps = path.children.filter((ep) => epMatches(ep, path.label, tag.label));
            // keep a path if it has any matching endpoints OR the path label itself matches
            if (eps.length || tagMatches(path.label)) {
              return { ...path, children: eps.length ? eps : path.children }; // if only path label matched, keep all its eps
            }
            return null;
          })
          .filter(Boolean) as typeof tag.children;

        // keep a tag if it has any matching paths OR the tag itself matches
        if (prunedPaths.length || tagMatches(tag.label)) {
          return { ...tag, children: prunedPaths.length ? prunedPaths : tag.children };
        }
        return null;
      })
      .filter(Boolean) as TagNode[];

    return next;
  }, [nodes, query]);

  // quick count of visible endpoints after filtering
  const visibleCount = useMemo(() => {
    let n = 0;
    filteredNodes.forEach((t) => t.children.forEach((p) => (n += p.children.length)));
    return n;
  }, [filteredNodes]);

  const refreshFromEditor = useCallback(() => applyRaw(readActiveEditorText()), [applyRaw, readActiveEditorText]);

  const flatEndpoints = useMemo<EndpointNode[]>(() => {
    const list: EndpointNode[] = [];
    nodes.forEach((tag) => tag.children.forEach((path) => path.children.forEach((ep) => list.push(ep))));
    return list;
  }, [nodes]);

  const totalSelected = useMemo(() => flatEndpoints.reduce((acc, ep) => acc + (selected[ep.id] ? 1 : 0), 0), [flatEndpoints, selected]);

  const toggleAll = useCallback(
    (checked: boolean) => {
      const next: Record<string, boolean> = {};
      if (checked) flatEndpoints.forEach((f) => (next[f.id] = true));
      setSelected(next);
    },
    [flatEndpoints],
  );

  const toggleTagAll = useCallback((tag: TagNode, checked: boolean) => {
    setSelected((prev) => {
      const copy = { ...prev };
      tag.children.forEach((p) =>
        p.children.forEach((ep) => {
          if (checked) copy[ep.id] = true;
          else delete copy[ep.id];
        }),
      );
      return copy;
    });
  }, []);

  // Check if all endpoints in a tag are selected
  const isTagFullySelected = useCallback((tag: TagNode) => {
    let total = 0;
    let selectedCount = 0;
    tag.children.forEach((p) => {
      p.children.forEach((ep) => {
        total++;
        if (selected[ep.id]) selectedCount++;
      });
    });
    return { isFullySelected: total > 0 && selectedCount === total, isPartiallySelected: selectedCount > 0 && selectedCount < total, total };
  }, [selected]);

  // loose-typed API header info
  const apiInfo = useMemo(() => {
    const anyDoc = doc as any;
    const info = anyDoc?.info ?? {};
    return {
      title: typeof info.title === "string" ? info.title : anyDoc?.title ?? "API",
      version: typeof info.version === "string" ? info.version : anyDoc?.version ?? "",
      description: typeof info.description === "string" ? info.description : anyDoc?.description ?? "",
    };
  }, [doc]);

  const handleGenerate = useCallback(
    async (pickedOverwrite?: number) => {
      if (!doc) return;

      const chosen = flatEndpoints.filter((f) => selected[f.id]);
      if (!chosen.length) return;
      const rootFolderName = apiInfo.title;

      const alreadyExists = await getFilesExists(activeProject, rootFolderName, chosen);
      if (alreadyExists && !pickedOverwrite) {
        // Show modal
        setConfirmOpen(true);
        return;
      } else {
        setConfirmOpen(false);
      }

      if ( !alreadyExists ) {
        pickedOverwrite = 1;
      }

      setBusy(true);
      setProgress({ current: 0, total: chosen.length });

      try {
        await generateSelected(context, doc, chosen,activeSource, (current, total) => setProgress({ current, total }),{
          activeProject,
          rootFolderName,
          pickedOverwrite,
        });
      } finally {
        setBusy(false);
        setIsSaved(true);
        setTimeout(() => {
          setIsSaved(false);
        }, 3000);
      }
    },
    [context, doc, flatEndpoints, selected, activeProject, apiInfo.title, apiInfo.version],
  );

  // mount + event wiring (unchanged)
  useEffect(() => {
    const last = (window as any).__voidenOpenAPILastPayload__;
    if (last && typeof last.raw === "string") applyRaw(last.raw);
    else refreshFromEditor();
    const fetchActiveTab = async ()=>{
      try {
        const tab = await context.tab?.getActiveTab() as DocumentTab;
        const project = await context.project?.getActiveProject();

        let relativePath = tab.source;
        if (project && tab.source.startsWith(project)) {
          relativePath = tab.source.slice(project.length);
          if (relativePath.startsWith('/')) {
            relativePath = relativePath.slice(1);
          }
        }

        setActiveSource(relativePath);
      } catch {

      }
    }
    fetchActiveTab();
  }, []);

  useEffect(() => {
    const EVENT_NAME = "voiden.openapi.process";
    const handler = (e: Event) => {
      const openHelper = (window as any).__voidenOpenOpenAPIPreview__;
      openHelper?.();
      setTimeout(() => openHelper?.(), 200);
      setTimeout(() => openHelper?.(), 400);

      const detail = (e as CustomEvent).detail || {};
      const {
        raw: injectedRaw,
        selectAll = false,
        autoGenerate = false,
        currentActiveProject = "",
      } = detail as { raw?: string; selectAll?: boolean; autoGenerate?: boolean; currentActiveProject?: string };

      if (typeof injectedRaw === "string") applyRaw(injectedRaw);
      else refreshFromEditor();

      setActiveProject(currentActiveProject);

      setTimeout(() => {
        if (selectAll) toggleAll(true);
        if (autoGenerate) handleGenerate(0);
      }, 0);
    };

    window.addEventListener(EVENT_NAME, handler as EventListener);
    return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
  }, [applyRaw, handleGenerate, refreshFromEditor, toggleAll]);

  // ────────────────────────────────────────────────────────────────────────────
  // UI
  // ────────────────────────────────────────────────────────────────────────────
  if (err) return <div className="p-3 flex text-text flex-col justify-center items-center gap-4 ">
    <CircleX size={40} className="inline mb-0.5 mr-2" />
    <span className="text-sm">OpenAPI parse error: {err}</span>
  </div>;

  if (isLoading) {
    return (
      <div className="p-3 flex flex-col text-text text-sm flex items-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-fg"></div>
        <span>Loading OpenAPI document...</span>
      </div>
    );
  }

  if (!nodes.length) {
    return (
      <div className="p-3 text-muted text-sm">
        No OpenAPI document loaded. Open a tab with an OpenAPI 3.0 JSON/YAML document and click the "OpenAPI Preview" button.
      </div>
    );
  }

  return (
    <div className="w-full openapiplugin">
      <div className="h-full grid grid-cols-[minmax(520px,1fr)_minmax(420px,1fr)] text-fg">
        {/* LEFT */}
        <div className="border-r border-line flex flex-col overflow-hidden">
          {/* Sticky header */}
          <div className="sticky top-0 z-10 border-b border-line bg-panel/80 backdrop-blur">
            <div className="px-3 py-2 space-y-2">
              <div className="flex items-baseline gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <h2 className="text-base font-semibold">{apiInfo.title}</h2>
                </label>
                {apiInfo.version && <span className="text-xs">v{apiInfo.version}</span>}
                <span className="ml-auto text-[11px] text-muted">
                  Showing <b>{visibleCount}</b> endpoint{visibleCount === 1 ? "" : "s"}
                </span>
              </div>
              {apiInfo.description && <p className="text-xs line-clamp-2 text-muted">{apiInfo.description}</p>}

              {/* Search / Filter */}
              <div className="flex items-center gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tags, path, description…"
                  className="bg-panel placeholder:text-comment rounded-lg outline-none border border-line px-3 py-1 font-mono w-full block relative bg-transparent text-fg"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="text-xs px-2 py-1 border border-light rounded hover:bg-selection"
                    title="Clear search"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Select All Section */}
          <div className="px-3 py-2 border-b border-line bg-panel">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={totalSelected === flatEndpoints.length && flatEndpoints.length > 0}
                ref={(el) => {
                  if (el) {
                    const someSelected = totalSelected > 0 && totalSelected < flatEndpoints.length;
                    el.indeterminate = someSelected;
                  }
                }}
                onChange={(e) => toggleAll(e.target.checked)}
                title={totalSelected === flatEndpoints.length ? "Unselect all endpoints" : "Select all endpoints"}
              />
              <span className="text-sm font-medium">Select All ({totalSelected}/{flatEndpoints.length})</span>
            </div>
          </div>

          <div className="overflow-auto p-3" style={{ height: "calc(100vh - 290px)" }}>
            {filteredNodes.map((tag) => {
              const folded = query ? false : !!foldedTags[tag.id];
              const { isFullySelected, isPartiallySelected } = isTagFullySelected(tag);

              return (
                <div key={tag.id} className="mb-2">
                  {/* Tag header */}
                  <div className="flex items-center gap-3 px-3 py-2 bg-block-header hover:bg-selection text-fg rounded">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isFullySelected}
                        ref={(el) => {
                          if (el) el.indeterminate = isPartiallySelected;
                        }}
                        onChange={(e) => toggleTagAll(tag, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        title={isFullySelected ? "Unselect all endpoints in this section" : "Select all endpoints in this section"}
                      />
                      <div 
                        className="font-medium text-sm uppercase tracking-wide cursor-pointer"
                        onClick={() => setFoldedTags((f) => ({ ...f, [tag.id]: !folded }))}
                      >
                        {tag.label || "Default"}
                      </div>
                      <div className="text-sm text-comment">{tag.description ||''}</div>
                    </div>
                    <div className="ml-auto flex items-center gap-3">
                      <div 
                        className="text-xs text-fg cursor-pointer"
                        onClick={() => setFoldedTags((f) => ({ ...f, [tag.id]: !folded }))}
                      >
                        {folded ? "▶" : "▼"}
                      </div>
                    </div>
                  </div>

                  {!folded && (
                    <div className="mt-2 ml-4 space-y-2">
                      {tag.children.map((path) => (
                        <div key={path.id}>
                          {/* Path label */}
                          <div className="px-1 py-1 text-[11px] text-muted font-mono">{path.label}</div>
                          <div className="space-y-2">
                            {path.children.map((ep) => (
                              <SwaggerOperationRow
                                key={ep.id}
                                ep={ep}
                                checked={!!selected[ep.id]}
                                expanded={!!expanded[ep.id]}
                                onToggleCheck={(v) => setSelected((s) => ({ ...s, [ep.id]: v }))}
                                onToggleExpand={() => setExpanded((x) => ({ ...x, [ep.id]: !x[ep.id] }))}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT */}
        <div className="p-3 border border-border flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-2 gap-3">
            <div className="text-sm text-fg">
            </div>
            <div className="text-sm text-success">
              <b>{isSaved ? "Saved" : ""}</b>
            </div>
            <button
              className="bg-button-primary cursor-pointer text-text px-3 py-1 rounded-sm text-sm disabled:opacity-50 disabled:cursor-not-allowed border border-line "
              disabled={!totalSelected || busy}
              onClick={() => {
                handleGenerate(0);
              }}
            >
              {busy ? `Generating… ${progress.current}/${progress.total}` : "Generate Voiden files"}
            </button>
          </div>
        </div>

        {/* Confirmation popup */}
        {confirmOpen && (
          <div className="absolute inset-x-0 z-50 flex justify-center" style={{ bottom: "50px" }}>
            <div className="pointer-events-auto w-full max-w-[700px] rounded-md border border-line bg-panel text-fg shadow-lg">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-line">
                <div className="text-sm font-medium">Files already exists</div>
                <button className="text-xs text-muted hover:text-fg" onClick={() => setConfirmOpen(false)} title="Close">
                  ✕
                </button>
              </div>

              {/* Body */}
              <div className="px-4 py-3 text-sm space-y-4">
                <p className="text-fg">The target files already exists. Do you want to overwrite it or create a new folder?</p>

                <div className="flex items-center justify-center gap-4">
                  <button
                    className="px-4 py-2 rounded bg-ui text-fg border border-line text-sm font-medium hover:bg-selection"
                    onClick={async () => {
                      handleGenerate(1);
                    }}
                  >
                    Overwrite
                  </button>
                  <button
                    className="px-4 py-2 rounded bg-ui text-fg border border-line text-sm font-medium hover:bg-selection"
                    onClick={async () => {
                      handleGenerate(2);
                    }}
                  >
                    Create New Folder
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const SwaggerOperationRow: React.FC<{
  ep: EndpointNode;
  checked: boolean;
  expanded: boolean;
  onToggleCheck: (v: boolean) => void;
  onToggleExpand: () => void;
}> = ({ ep, checked, expanded, onToggleCheck, onToggleExpand }) => {
  const theme = SWAGGER[methodKey(ep.method)] || SWAGGER.default;

  return (
    <div className="w-full space-y-3">
      <div className={`rounded-md overflow-hidden border border-method-${theme.method}`}>
        {/* Header row (flex) */}
        <div
          className="cursor-pointer"
          onClick={() => {
            onToggleExpand();
          }}
        >
          <div className="flex items-stretch w-full">
            <div className={`flex-none w-[30px] shrink-0 grow-0 flex items-center justify-center px-3 py-2 text-xs tracking-wide`}>
              <input
                className="mt-1.5"
                type="checkbox"
                checked={checked}
                onChange={(e) => onToggleCheck(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                title="Select for generation"
              />
            </div>

            {/* METHOD rail (fixed 70px) */}
            <div
              className={`flex-none w-[50px] shrink-0 grow-0 flex items-center justify-center px-3 py-2 text-xs font-bold uppercase tracking-wide ${theme.rail}`}
            >
              {ep.method.toUpperCase()}
            </div>

            {/* Middle (expands): checkbox + URL (bold) + extra non-bold text */}
            <div className={`flex-1 min-w-0 px-3 py-2 `}>
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs break-all text-fg font-bold">
                    {ep.path}
                    {/* extra text after URL (non-bold) — using ep.summary by default */}
                    {ep.summary ? <span className="font-normal text-muted ml-2">{ep.summary}</span> : null}
                  </div>
                </div>
              </div>
            </div>

            {/* Right (content-sized) — button pinned to the right */}
            <div className={`shrink-0 px-3 flex items-center py-2 `}>
              <div className="">
                <button
                  className="text-[11px] text-muted hover:text-fg shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand();
                  }}
                >
                  {expanded ? <ArrowUp size={14}/> : <ArrowDown size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* details (inline) */}
        {expanded && (
          <div className={`border-t border-method-${theme.method} p-3 bg-ui`}>
            <OperationDetails ep={ep} />
          </div>
        )}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Details (Parameters / Request / Responses)
// ──────────────────────────────────────────────────────────────────────────────
const OperationDetails: React.FC<{ ep: EndpointNode; dense?: boolean }> = ({ ep, dense }) => {
  const rawOp: any = (ep as any).raw || ep || {};
  const parameters: any[] = Array.isArray(ep.parameters) ? ep.parameters : Array.isArray(rawOp.parameters) ? rawOp.parameters : [];
  const requestBody = ep.requestBody ?? rawOp.requestBody ?? {};
  const responses = ep.responses ?? rawOp.responses ?? {};

  // Pick best content (application/json → application/*+json → */* → first)
  function pickJsonishContent(content: any) {
    if (!content || typeof content !== "object") return undefined;
    if (content["application/json"]) return content["application/json"];
    const plusJson = Object.keys(content).find((k) => /^application\/.+\+json$/i.test(k));
    if (plusJson) return content[plusJson];
    if (content["*/*"]) return content["*/*"];
    return Object.values(content)[0];
  }

  // ── Example synthesizer (tiny, non-recursive beyond a safe depth) ──────────
  function synthesizeExampleFromSchema(schema: any, depth = 0): any {
    if (!schema || depth > 6) return null;

    if (schema.const !== undefined) return schema.const;
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
    if (schema.default !== undefined) return schema.default;
    if (schema.example !== undefined) return schema.example;

    const t = schema.type || (schema.properties ? "object" : schema.items ? "array" : undefined);

    switch (t) {
      case "object": {
        const props = schema.properties || {};
        const out: any = {};
        for (const [key, propSchema] of Object.entries<any>(props)) {
          out[key] = synthesizeExampleFromSchema(propSchema, depth + 1);
        }
        // required-only fallback if no properties populated
        if (!Object.keys(out).length && Array.isArray(schema.required)) {
          for (const key of schema.required) out[key] = null;
        }
        return out;
      }
      case "array": {
        const item = schema.items || {};
        // cap array size to 1 to keep panel small
        return [synthesizeExampleFromSchema(item, depth + 1)];
      }
      case "integer":
      case "number":
        return 0;
      case "boolean":
        return false;
      case "string":
        if (schema.format === "date-time") return new Date().toISOString();
        if (schema.format === "date") return new Date().toISOString().slice(0, 10);
        if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000000";
        if (schema.format === "email") return "user@example.com";
        return "string";
      default: {
        if (schema.anyOf?.length) return synthesizeExampleFromSchema(schema.anyOf[0], depth + 1);
        if (schema.oneOf?.length) return synthesizeExampleFromSchema(schema.oneOf[0], depth + 1);
        if (schema.allOf?.length) {
          return schema.allOf.reduce((acc: any, s: any) => {
            const v = synthesizeExampleFromSchema(s, depth + 1);
            return typeof acc === "object" && acc && typeof v === "object" && v ? { ...acc, ...v } : acc ?? v;
          }, {});
        }
        return null;
      }
    }
  }

  // Request body
  const reqJson = pickJsonishContent(requestBody?.content);
  const reqSchema = reqJson?.schema;
  const reqExampleExplicit = reqJson?.example ?? reqJson?.examples?.default?.value ?? reqSchema?.example ?? reqSchema?.examples?.default?.value;
  const reqExample = reqExampleExplicit ?? (reqSchema ? synthesizeExampleFromSchema(reqSchema) : undefined);

  // Local UI state for tabs
  const [reqView, setReqView] = React.useState<"example" | "schema">(reqExample != null ? "example" : "schema");
  const [respView, setRespView] = React.useState<Record<string, "example" | "schema">>({});

  // Tiny toggle header
  const Tabs: React.FC<{
    available: { example: boolean; schema: boolean };
    value: "example" | "schema";
    onChange: (v: "example" | "schema") => void;
  }> = ({ available, value, onChange }) => {
    const hasBoth = available.example && available.schema;
    if (!hasBoth) {
      return <div className="text-[11px] text-fg mt-1">{available.example ? "Example" : "Schema"}</div>;
    }
    return (
      <div className="flex items-center text-fg gap-3 text-[12px] mt-1">
        <button className={`hover:underline ${value === "example" ? "font-semibold" : ""}`} onClick={() => onChange("example")} type="button">
          Example
        </button>
        <span className="text-fg">|</span>
        <button className={`hover:underline ${value === "schema" ? "font-semibold" : ""}`} onClick={() => onChange("schema")} type="button">
          Schema
        </button>
      </div>
    );
  };

  return (
    <div className={dense ? "space-y-3" : "space-y-4"}>
      {/* Parameters */}
      <section>
        <h4 className="text-[12px] font-semibold mb-1 text-fg">Parameters</h4>
        {parameters.length === 0 ? (
          <div className="text-xs text-muted">No parameters</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs border-separate border-spacing-y-1">
              <thead className="text-muted">
                <tr>
                  <th className="text-left font-normal">Name</th>
                  <th className="text-left font-normal">In</th>
                  <th className="text-left font-normal">Type</th>
                  <th className="text-left font-normal">Required</th>
                  <th className="text-left font-normal">Description</th>
                </tr>
              </thead>
              <tbody>
                {parameters.map((p, i) => {
                  const t = p.schema?.type ?? p.type ?? (p.schema?.items ? `array<${p.schema.items?.type || "object"}>` : "");
                  return (
                    <tr key={i} className="align-top text-fg">
                      <td className="pr-3 font-mono">{p.name}</td>
                      <td className="pr-3">{p.in}</td>
                      <td className="pr-3">{t}</td>
                      <td className="pr-3">{p.required ? "Yes" : "No"}</td>
                      <td className="pr-3 text-muted">{p.description || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Request body */}
      <section>
        <h4 className="text-[12px] font-semibold mb-1 text-fg">Request body</h4>
        {!requestBody || (!reqSchema && reqExample == null) ? (
          <div className="text-xs text-muted">No body</div>
        ) : (
          <>
            {requestBody.description && <div className="text-xs text-muted mb-1">{requestBody.description}</div>}

            <Tabs available={{ example: reqExample != null, schema: !!reqSchema }} value={reqView} onChange={setReqView} />

            {reqView === "example" && reqExample != null && <CodeBox value={reqExample} />}
            {reqView === "schema" && reqSchema != null && <CodeBox value={reqSchema} />}
          </>
        )}
      </section>

      {/* Responses */}
      <section>
        <h4 className="text-[12px] font-semibold mb-2 text-fg">Responses</h4>
        {!responses || Object.keys(responses).length === 0 ? (
          <div className="text-xs text-muted">No responses</div>
        ) : (
          <div className="space-y-2">
            {Object.entries<any>(responses).map(([code, resp]) => {
              const json = pickJsonishContent(resp?.content);
              const schema = json?.schema;
              const explicit = json?.example ?? json?.examples?.default?.value ?? schema?.example ?? schema?.examples?.default?.value;
              const example = explicit ?? (schema ? synthesizeExampleFromSchema(schema) : undefined);

              const current = respView[code] ?? (example != null ? "example" : "schema");
              const setCurrent = (v: "example" | "schema") => setRespView((m) => ({ ...m, [code]: v }));

              return (
                <div key={code} className="rounded border border-line p-2">
                  <div className={`text-xs font-semibold ${StatusColor(String(code))}`}>{code}</div>
                  {resp?.description && <div className="text-xs text-muted mt-0.5">{resp.description}</div>}

                  <Tabs available={{ example: example != null, schema: !!schema }} value={current} onChange={setCurrent} />

                  {current === "schema" && schema != null && <CodeBox value={schema} />}
                  {current === "example" && example != null && <CodeBox value={example} />}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default OpenAPIImportPanel;
