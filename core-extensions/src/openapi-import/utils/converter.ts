import type { PluginContext } from "@voiden/sdk/ui";
import * as jsyaml from "js-yaml";

declare global {
  interface Window {
    jsyaml?: { load: (str: string) => any };
    __voidenHelpers__?: { [pluginName: string]: any };
  }
}

export type OpenAPIDocument = {
  openapi: string; // "3.0.x" or "3.1.x"
  info?: { title?: string; version?: string;[k: string]: any }; // optional but handy
  servers?: { url: string }[];
  paths: Record<string, any>;
  components?: any;
};

export type TagNode = { id: string; description:string; type: "tag"; label: string; children: PathNode[] };
export type PathNode = { id: string; type: "path"; label: string; children: EndpointNode[] };
export type EndpointNode = {
  id: string;
  type: "endpoint";
  tag?: string;
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  description?: string;
  requestBody?: any;
  parameters?: any[];
  responses?: Record<string, any>;
  raw?: any; // keep original op for debugging if needed
};

const looksLikeYaml = (s: string) => {
  const t = s.trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return false;
  return /^openapi\s*:/.test(t) || /:\s*\S/.test(t);
};

export const parseOpenAPI = (raw: string): OpenAPIDocument => {
  let doc: any;
  try {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      doc = JSON.parse(raw);
    } else {
      doc = jsyaml.load(raw);
    }
  } catch (e: any) {
    throw new Error(`Failed to parse: ${e?.message || e}`);
  }
  if (!doc?.openapi || !String(doc.openapi).startsWith("3.")) throw new Error("OpenAPI 3.x required");
  if (!doc.paths) throw new Error('Missing "paths"');
  return doc;
};

// ──────────────────────────────────────────────────────────────────────────────
// $ref resolver (supports #/components/... and merges simple allOf)
// ──────────────────────────────────────────────────────────────────────────────

type DerefFn = <T = any>(value: T) => T;

/** Tiny JSON pointer reader for "#/a/b/c" */
const getByPointer = (root: any, pointer: string) => {
  if (!pointer.startsWith("#/")) return undefined;
  const parts = pointer
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: any = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
};

/** Deep merge tailored for JSON Schemas & OpenAPI bits (very small subset) */
const mergeObjects = (a: any, b: any): any => {
  if (a === undefined) return b;
  if (b === undefined) return a;
  // Explicit null checks (typeof null === 'object' in JS!)
  if (a === null) return b;
  if (b === null) return a;
  if (Array.isArray(a) && Array.isArray(b)) {
    // For things like "required": unique union
    const set = new Set([...(a as any[]), ...(b as any[])]);
    return Array.from(set);
  }
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== "object" || typeof b !== "object") {
    // Primitive or array/object mismatch: prefer "b" (override)
    return b;
  }
  const out: any = { ...a };
  for (const k of Object.keys(b)) {
    if (k === "allOf") continue; // handled elsewhere
    out[k] = mergeObjects(a[k], b[k]);
  }
  return out;
};

/** Create a ref resolver for a given document */
const createOpenApiRefResolver = (doc: OpenAPIDocument) => {
  const cache = new Map<any, any>(); // memo for objects
  const refCache = new Map<string, any>(); // memo for refs by pointer
  const resolvingStack = new Set<string>(); // detect simple cycles

  const deepDeref: DerefFn = (value: any): any => {
    if (value == null) return value;

    // Primitive
    if (typeof value !== "object") return value;

    // Already memoized
    if (cache.has(value)) return cache.get(value);

    // Array
    if (Array.isArray(value)) {
      const out = value.map(deepDeref);
      cache.set(value, out);
      return out;
    }

    // Object: handle $ref
    if (typeof value.$ref === "string") {
      const ref = value.$ref as string;
      if (refCache.has(ref)) {
        // Merge local overrides on top of resolved ref
        const base = refCache.get(ref);
        const merged = mergeObjects(base, { ...value, $ref: undefined });
        cache.set(value, merged);
        return merged;
      }

      if (resolvingStack.has(ref)) {
        // circular; fall back to the ref itself to avoid infinite loop
        return { ...value, __circularRef__: true };
      }

      resolvingStack.add(ref);
      const target = getByPointer(doc as any, ref);
      const resolvedTarget = deepDeref(target);
      refCache.set(ref, resolvedTarget);

      const merged = mergeObjects(resolvedTarget, { ...value, $ref: undefined });
      cache.set(value, merged);
      resolvingStack.delete(ref);
      return merged;
    }

    // Object: handle allOf (very basic merge)
    if (Array.isArray(value.allOf)) {
      const parts = value.allOf.map(deepDeref);
      const mergedAll = (parts as any[]).reduce<any>((acc, cur) => mergeObjects(acc, cur), {} as any);
      const rest = { ...value };
      delete rest.allOf;
      const merged = mergeObjects(mergedAll, deepDeref(rest));
      cache.set(value, merged);
      return merged;
    }

    // Recurse props
    const out: any = {};
    cache.set(value, out); // set early to break self-refs during recursion
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepDeref(v);
    }
    return out;
  };

  return deepDeref;
};

// ──────────────────────────────────────────────────────────────────────────────

export const openApiToNodes = (doc: OpenAPIDocument): TagNode[] => {
  const deref = createOpenApiRefResolver(doc);

  const tagIndex = new Map<string, TagNode>();
  const ensureTag = (name: string) => {
    if (!tagIndex.has(name)) tagIndex.set(name, { id: `tag:${name}`, description: "", type: "tag", label: name, children: [] });
    return tagIndex.get(name)!;
  };

  // Add guard for null/undefined paths (typeof null === 'object' in JS!)
  if (!doc.paths || doc.paths === null || typeof doc.paths !== 'object' || Array.isArray(doc.paths)) {
    return [];
  }

  Object.entries<any>(doc.paths).forEach(([path, item]) => {
    // Skip null/undefined path items (typeof null === 'object')
    if (!item || item === null || typeof item !== 'object' || Array.isArray(item)) return;
    
    Object.entries<any>(item).forEach(([method, op]) => {
      // Skip null/undefined operations (typeof null === 'object')
      if (!op || op === null || typeof op !== 'object' || Array.isArray(op)) return;
      
      const http = String(method).toLowerCase();
      if (!["get", "post", "put", "patch", "delete", "options", "head", "trace"].includes(http)) return;

      // Deref the pieces we care about
      const opParameters = Array.isArray(op?.parameters) ? op.parameters.map((p: any) => deref(p)) : [];
      const opRequestBody = op?.requestBody ? deref(op.requestBody) : undefined;
      const opResponses = op?.responses ? deref(op.responses) : undefined;

      const ep: EndpointNode = {
        id: `ep:${http}:${path}`,
        type: "endpoint",
        path,
        method: http,
        operationId: op?.operationId,
        summary: op?.summary,
        description: op?.description,
        parameters: opParameters,
        requestBody: opRequestBody,
        responses: opResponses,
        tag: (op?.tags && op.tags[0]) || "untagged",
        raw: op, // keep original for debugging if needed
      };

      const tagNode = ensureTag(ep.tag!);
      let pathNode = tagNode.children.find((p) => p.label === path);
      if (!pathNode) {
        pathNode = { id: `path:${path}:${ep.tag}`, type: "path", label: path, children: [] };
        tagNode.children.push(pathNode);
      }
      pathNode.children.push(ep);
    });
  });

  return Array.from(tagIndex.values()).sort((a, b) => a.label.localeCompare(b.label));
};

const firstServer = (doc: OpenAPIDocument) => {
  const url = doc.servers?.[0]?.url || "";
  return url.endsWith("/") ? url.slice(0, -1) : url;
};

// ⬇️ Add these helpers near your converter:

const makeUid = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const toRows = (pairs: Array<[string, string]>) =>
  pairs.map(([k, v]) => ({
    attrs: { disabled: false },
    row: [String(k), String(v ?? "")],
  }));

function sampleFromSchema(schema: any, depth = 0): any {
  if (!schema || depth > 8) return null;

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
        out[key] = sampleFromSchema(propSchema, depth + 1);
      }
      // fallback if nothing resolved
      if (Object.keys(out).length === 0) return {};
      return out;
    }
    case "array": {
      const item = schema.items || {};
      return [sampleFromSchema(item, depth + 1)];
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
    default:
      if (schema.anyOf?.length) return sampleFromSchema(schema.anyOf[0], depth + 1);
      if (schema.oneOf?.length) return sampleFromSchema(schema.oneOf[0], depth + 1);
      if (schema.allOf?.length) {
        return schema.allOf.reduce((acc: any, s: any) => {
          const v = sampleFromSchema(s, depth + 1);
          return typeof acc === "object" && acc && typeof v === "object" && v ? { ...acc, ...v } : acc ?? v;
        }, {});
      }
      return null;
  }
}

const asJsonBlockString = (value: any): string => {
  if (value == null) return "{}";
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      /* keep as-is */
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
};

// Pick the most suitable content entry from a responses/requestBody "content" object
function pickJsonishContent(content: any) {
  if (!content || typeof content !== "object") return undefined;

  // exact JSON
  if (content["application/json"]) return content["application/json"];

  // JSON-ish vendor types: application/*+json
  const plusJson = Object.keys(content).find((k) => /^application\/.+\+json$/i.test(k));
  if (plusJson) return content[plusJson];

  // Wildcard */*
  if (content["*/*"]) return content["*/*"];

  // Fallback to the first entry
  const first = Object.values(content)[0];
  return first;
}

function sampleFromParamSchemaToString(schema: any): string {
  const v = sampleFromSchema(schema);
  if (v === undefined || v === null) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return String(v);
}

/** Pull a JSON example (object/array/primitive) from request body (already de-ref’d) */
function getRequestJsonExample(ep: EndpointNode) {
  const jsonish = pickJsonishContent(ep.requestBody?.content);
  if (!jsonish) return undefined;

  const schema = jsonish.schema;
  const ex = jsonish.example ?? jsonish.examples?.default?.value ?? schema?.example ?? schema?.examples?.default?.value;

  if (ex !== undefined) {
    if (typeof ex === "string") {
      try {
        return JSON.parse(ex);
      } catch {
        return ex;
      }
    }
    return ex;
  }
  if (schema) return sampleFromSchema(schema);
  return undefined;
}

/** Pull a JSON example from a response content (already de-ref’d) */
function getResponseJsonExample(resp: any) {
  const jsonish = pickJsonishContent(resp?.content);
  if (!jsonish) return undefined;

  const schema = jsonish.schema;
  const ex = jsonish.example ?? jsonish.examples?.default?.value ?? schema?.example ?? schema?.examples?.default?.value;

  if (ex !== undefined) {
    if (typeof ex === "string") {
      try {
        return JSON.parse(ex);
      } catch {
        return ex;
      }
    }
    return ex;
  }
  if (schema) return sampleFromSchema(schema);
  return undefined;
}

const getVoidenApiHelpers = () => {
  const helpers = (window as any).__voidenHelpers__?.["voiden-rest-api"];
  if (!helpers || typeof helpers.convertBlocksToVoidFile !== "function") {
    throw new Error("Required 'voiden-rest-api' plugin helpers not found. Please enable the Voiden REST API plugin.");
  }
  return helpers;
};

function isPlainObject(v: any): v is Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v);
}

// Turn a schema into a compact string for table cells (not pretty-printed)
function sampleForCell(schema: any): string {
  const v = sampleFromSchema(schema);
  if (v === undefined || v === null) return "";
  if (isPlainObject(v) || Array.isArray(v)) {
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }
  return String(v);
}

/**
 * Flatten an object schema's immediate properties to rows.
 * Deeply nested objects are flattened with dot notation (up to `maxDepth`).
 * Arrays yield a single representative sample (index 0) stringified.
 */
function flattenSchemaToRows(baseName: string, schema: any, maxDepth = 3, depth = 0): Array<[string, string]> {
  const rows: Array<[string, string]> = [];

  const type = schema?.type || (schema?.properties ? "object" : schema?.items ? "array" : undefined);

  if (type === "object" && isPlainObject(schema?.properties)) {
    for (const [k, subSchema] of Object.entries<any>(schema.properties)) {
      const key = `${k}`;
      const subType = subSchema?.type || (subSchema?.properties ? "object" : subSchema?.items ? "array" : undefined);

      if (subType === "object" && depth < maxDepth) {
        rows.push(...flattenSchemaToRows(key, subSchema, maxDepth, depth + 1));
      } else {
        rows.push([key, ""]);
      }
    }
    if (rows.length === 0) {
      // object with no properties -> at least give one row so the user can fill it
      rows.push([baseName, ""]);
    }
    return rows;
  }

  // arrays or primitives -> single row
  rows.push([baseName, sampleForCell(schema)]);
  return rows;
}

const endpointToVoidenFileContent = async (ep: EndpointNode, doc: OpenAPIDocument,activeSource:string): Promise<string> => {
  const helpers = getVoidenApiHelpers();
  const blocks: any[] = [];
  //OpenApi Link
  const fileName = activeSource.split("/").pop();
  blocks.push({
    type: "openapispecLink",
    attrs: {
      uid: makeUid(),
      filePath: activeSource,
      filename: fileName,
      isExternal: false
    }
  })

  // REQUEST
  blocks.push({
    type: "request",
    attrs: { uid: makeUid() },
    content: [
      {
        type: "method",
        attrs: { uid: makeUid(), method: ep.method.toUpperCase(), importedFrom: "", visible: true },
        content: ep.method.toUpperCase(), // string
      },
      { type: "url", attrs: { uid: makeUid() }, content: `${firstServer(doc)}${ep.path}` }, // string
    ],
  });

  // HEADERS
  const headers = (ep.parameters || [])
    .filter((p) => p.in === "header")
    .map((p) => [p.name, p.schema?.default ?? p.schema?.example ?? ""] as [string, string]);

  if (headers.length) {
    blocks.push({
      type: "headers-table",
      attrs: { uid: makeUid(), importedFrom: "" },
      content: [{ type: "table", rows: toRows(headers) }],
    });
  }

  // QUERY
  const queries: Array<[string, string]> = [];
  (ep.parameters || [])
    .filter((p) => p.in === "query")
    .forEach((p) => {
      const schema = p.schema || {};
      const type = schema?.type || (schema?.properties ? "object" : schema?.items ? "array" : undefined);

      // If style/explode suggest we should keep it as a single param, don't expand
      const style = p.style ?? "form";
      const explode = p.explode ?? true; // OpenAPI default for query is explode=true with style=form

      if (type === "object" && explode && style === "form") {
        // Expand object props into multiple rows (rqo.query, rqo.page, …)
        queries.push(...flattenSchemaToRows(p.name, schema));
      } else {
        // Single row (primitive, array, or non-exploded object)
        queries.push([p.name, ""]);
      }
    });

  if (queries.length) {
    blocks.push({
      type: "query-table",
      attrs: { uid: makeUid(), importedFrom: "" }, // ensure empty string is quoted
      content: [{ type: "table", rows: toRows(queries) }],
    });
  }

  // REQUEST BODY
  const reqExample = getRequestJsonExample(ep); // may synthesize now with full props
  if (reqExample !== undefined && reqExample !== null) {
    blocks.push({ type: "paragraph", attrs: { uid: makeUid() }, content: "Request Body – Example" });
    blocks.push({
      type: "json_body",
      attrs: { uid: makeUid(), importedFrom: "", contentType: "json", body: asJsonBlockString(reqExample) },
    });
  }

  // RESPONSES
  if (ep.responses && Object.keys(ep.responses).length) {
    for (const [code, resp] of Object.entries<any>(ep.responses)) {
      const respExample = getResponseJsonExample(resp); // synthesized with full props

      if (respExample !== undefined && respExample !== null) {
        blocks.push({
          type: "paragraph",
          attrs: { uid: makeUid() },
          content: `Response ${code}${resp?.description ? ` – ${resp.description}` : ""} – Example`,
        });
        blocks.push({
          type: "inline-json",
          text: asJsonBlockString(respExample),
        });
      }
    }
  }

  const title = ep.summary || ep.operationId || `${ep.method.toUpperCase()} ${ep.path}`;
  return helpers.convertBlocksToVoidFile(title, blocks);
};

export function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/\/+/g, "-")
    .replace(/[^a-zA-Z0-9-\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

export const getFolderExists = async (activeProject?: string, rootFolderName?: string) => {
  const electronApi = (window as any).electron;
  const alreadExists = await electronApi!.files!.getDirectoryExist(activeProject!, sanitizeName(rootFolderName!));

  return alreadExists;
};

export const getFilesExists = async (activeProject?: string, rootFolderName?: string, endpoints?: EndpointNode[]) => {
  const electronApi = (window as any).electron;
  const alreadExists = await electronApi!.files!.getDirectoryExist(activeProject!, sanitizeName(rootFolderName!));
  const willWriteFiles = Boolean(activeProject && electronApi?.files?.write && electronApi?.files?.createDirectory);
  if (!alreadExists || !endpoints || !willWriteFiles) {
    return false;
  } // No folder

  rootFolderName = sanitizeName(rootFolderName || "openapi-import");
  const rootPath = `${activeProject}/${rootFolderName}/requests`;

  for (const ep of endpoints) {
    try {
      const tagFolder = sanitizeName(ep.tag || "untagged");
      const tagPath = `${rootPath}/${tagFolder}`;
      const alreadExistsTag = await electronApi!.files!.getDirectoryExist(rootPath, tagFolder);
      if (alreadExistsTag) {
        const safePath = ep.path.replace(/[^\w/-]+/g, "").replace(/\//g, "_") || "root";
        const fileName = `${ep.method}_${safePath}.void`.replace('__', '_');

        const alreadExistsFile = await electronApi!.files!.getFileExist(tagPath, fileName);
        if (alreadExistsFile) {
          return true;
        }
      }
    } catch (e) {
      /* error */
    }
  }

  return false;
};

export const generateSelected = async (
  context: PluginContext,
  doc: OpenAPIDocument,
  endpoints: EndpointNode[],
  activeSource:string,
  onProgress?: (current: number, total: number) => void,
  opts?: { activeProject?: string; rootFolderName?: string; pickedOverwrite?: number },
) => {
  const electronApi = (window as any).electron;
  const createdTagFolders = new Set<string>();

  // Prefer the value passed from the UI (like the Postman importer).
  let activeProject = opts?.activeProject;

  // Fallback to electron state if available
  if (!activeProject && electronApi?.state?.get) {
    try {
      activeProject = (await electronApi.state.get())?.activeProject;
    } catch (e) {
      console.warn("Could not read activeProject from electron.state.get()", e);
    }
  }

  // If we have a project, we write files; otherwise, open tabs.
  const willWriteFiles = Boolean(activeProject && electronApi?.files?.write && electronApi?.files?.createDirectory);

  // Create a predictable root folder (similar to the Postman importer flow)
  let rootFolderName = sanitizeName(opts?.rootFolderName || "openapi-import");
  let rootPath = willWriteFiles ? `${activeProject}/${rootFolderName}` : undefined;

  // Ensure folder structure
  if (willWriteFiles && rootPath) {
    // If not found or create new folder
    const alreadyExists = await electronApi!.files!.getDirectoryExist(activeProject!, rootFolderName);
    if (opts?.pickedOverwrite != 1 || !alreadyExists) {
      try {
        rootFolderName = await electronApi!.files!.createDirectory(activeProject!, rootFolderName);
        rootPath = `${activeProject}/${rootFolderName}`;
      } catch (_) {
        // ok if it already exists
      }
      try {
        await electronApi!.files!.createDirectory(rootPath, "requests");
      } catch (_) {
        // ok if it already exists
      }
    }
  }

  let i = 0;
  for (const ep of endpoints) {
    try {
      const md = await endpointToVoidenFileContent(ep, doc,activeSource);

      if (willWriteFiles && rootPath) {
        const tagFolder = sanitizeName(ep.tag || "untagged");
        const requestsPath = `${rootPath}/requests`;
        const tagPath = `${requestsPath}/${tagFolder}`;

        if (!createdTagFolders.has(tagFolder)) {
          try {
            const tagFolderExists = await electronApi!.files!.getDirectoryExist(requestsPath, tagFolder);
            if (!tagFolderExists) {
              await electronApi!.files!.createDirectory(requestsPath, tagFolder);
            }
          } catch (_) {
            // ok if exists
          }
          createdTagFolders.add(tagFolder);
        }

        // Use .void (this matters)
        const safePath = ep.path.replace(/[^\w/-]+/g, "").replace(/\//g, "_") || "root";
        const fileName = `${ep.method}_${safePath}.void`.replace('__', '_');
        const filePath = `${tagPath}/${fileName}`;

        await electronApi!.files!.write(filePath, md);
      } else {
        // No active project – fallback to opening tabs
        await context.openVoidenTab(ep.summary || ep.operationId || `${ep.method.toUpperCase()} ${ep.path}`, md, { readOnly: false });
      }
    } catch (error: any) {
      console.error(`Failed to generate for ${ep.path}: ${error?.message || error}`);
    } finally {
      i++;
      onProgress?.(i, endpoints.length);
    }
  }
};
