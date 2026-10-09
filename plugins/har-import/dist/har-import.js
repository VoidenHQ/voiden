const ne = 2, ie = { id: "har-import", name: "HTTP Archive (HAR) Importer", description: "Import HTTP Archive (.har) files and automatically convert captured browser network requests into native Voiden request files with full support for headers, cookies, query parameters, request bodies, and optional static asset filtering.", version: "1.0.0", voidenVersion: ">=2.0.0", author: "Voiden Team", enabled: !0, priority: 50, readme: "Import HTTP Archive (.har) files and automatically convert them into native Voiden .void request files. Supports headers, cookies, query parameters, request bodies (JSON, XML, Form Data, Multipart, Text), folder/page grouping, and static asset filtering.", capabilities: { ui: { buttons: [{ id: "har-import-btn", location: "sidebar-left", icon: "PackageImport", tooltip: "Import HAR Collection", description: "Opens file picker to select and import HTTP Archive (.har) JSON files" }], description: "Adds import button for HAR files" }, fileSystem: { operations: ["create-directory", "write-file"], description: "Creates folder structure and .void files from HAR network capture" }, integration: { dependencies: [{ extension: "voiden-rest-api", reason: "Uses voiden-rest-api helpers to generate compatible REST API blocks", required: !0 }], description: "Depends on voiden-rest-api extension for REST block generation" } }, dependencies: { core: "^1.0.0", sdk: "^1.0.0", "voiden-rest-api": "^1.0.0" }, features: ["Import HTTP Archive (.har) JSON files captured from browser Developer Tools", "Automatically create folder structure matching page titles or domain hostnames", "Convert each HTTP request entry into a native .void file", "Preserve request headers and convert to headers-table blocks", "Preserve cookies and merge into headers or auth details", "Extract query parameters and convert to query-table blocks", "Support for all HTTP methods (GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD, etc.)", "Import JSON request bodies and convert to json_body blocks", "Import XML request bodies and convert to xml_body blocks", "Import form-data bodies and convert to multipart-table blocks", "Import URL-encoded bodies and convert to urlencoded-table blocks", "Import Plain Text bodies", "Optional static asset filtering (ignore images, stylesheets, scripts, fonts)", "Sanitize file and folder names for filesystem compatibility", "Progress tracking and cancel support during import", "Batch file creation with throttling to prevent system overload", "Uses voiden-rest-api helpers for consistent block generation"] }, O = window.__voiden_shims__.react, {
  useState: I,
  useEffect: D,
  useCallback: ae,
  useMemo: ce,
  useRef: F,
  useContext: le,
  createContext: ue,
  forwardRef: de,
  memo: pe,
  Fragment: me,
  createElement: fe,
  cloneElement: he,
  Children: ge,
  StrictMode: we,
  Suspense: ye,
  lazy: ve,
  isValidElement: xe,
  Component: be,
  PureComponent: Ce,
  createRef: Ie,
  startTransition: Te,
  useReducer: ke,
  useLayoutEffect: Se,
  useImperativeHandle: _e,
  useDebugValue: Ae,
  useTransition: Ne,
  useDeferredValue: qe,
  useId: Ee
} = O, L = window.__voiden_shims__["react/jsx-runtime"], y = L.jsx, T = L.jsxs;
L.Fragment;
const V = window.__voiden_shims__["@tanstack/react-query"], {
  useQuery: Pe,
  useMutation: je,
  useQueryClient: B,
  useInfiniteQuery: He,
  QueryClient: Re,
  QueryClientProvider: Le,
  QueryCache: Me,
  MutationCache: De,
  useIsFetching: $e,
  useIsMutating: Oe,
  useSuspenseQuery: Ue,
  useSuspenseInfiniteQuery: Fe,
  useSuspenseQueries: Ve,
  useQueries: Be,
  HydrationBoundary: Qe,
  dehydrate: We,
  hydrate: Xe,
  focusManager: Je,
  onlineManager: ze,
  replaceEqualDeep: Ge,
  hashKey: Ke
} = V;
function Q(r) {
  return r && typeof r == "object" && r.log && typeof r.log == "object" && Array.isArray(r.log.entries);
}
const $ = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
  "avif",
  "bmp",
  "tiff",
  "css",
  "scss",
  "less",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "mp3",
  "mp4",
  "wav",
  "ogg",
  "webm",
  "aac",
  "flac",
  "pdf",
  "map",
  "swf"
]), W = [
  "image/",
  "font/",
  "audio/",
  "video/"
], X = /* @__PURE__ */ new Set([
  "text/css",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "application/font-woff",
  "application/font-woff2",
  "application/x-font-ttf",
  "application/vnd.ms-fontobject"
]);
function J(r, o) {
  if (o) {
    const t = o.split(";")[0].trim().toLowerCase();
    if (X.has(t) || W.some((e) => t.startsWith(e))) return !0;
  }
  try {
    const e = new URL(r).pathname, i = e.lastIndexOf(".");
    if (i !== -1 && i < e.length - 1) {
      const a = e.slice(i + 1).toLowerCase();
      if ($.has(a))
        return !0;
    }
  } catch {
    const t = r.split("?")[0].split("#")[0].toLowerCase(), e = t.lastIndexOf(".");
    if (e !== -1 && e < t.length - 1) {
      const i = t.slice(e + 1);
      if ($.has(i))
        return !0;
    }
  }
  return !1;
}
function z() {
  var t;
  const o = (t = (typeof window < "u" ? window : globalThis).__voidenHelpers__) == null ? void 0 : t["voiden-wrapper-api-extension"];
  if (!o)
    throw new Error(
      "Voiden API helpers not found. Make sure voiden-wrapper-api-extension is loaded before har-import."
    );
  return o;
}
function j(r) {
  return !r || !r.trim() ? "unnamed-request" : r.trim().replace(/\/+/g, "-").replace(/[^a-zA-Z0-9-\s_.]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}
function G(r) {
  const o = (r.mimeType || "").toLowerCase();
  if (o.includes("application/json") || o.includes("+json")) return "json";
  if (o.includes("application/xml") || o.includes("text/xml") || o.includes("+xml")) return "xml";
  if (o.includes("text/html")) return "html";
  if (r.text) {
    const t = r.text.trim();
    if (t.startsWith("{") || t.startsWith("[")) return "json";
    if (t.startsWith("<"))
      return t.toLowerCase().includes("<!doctype html") || t.toLowerCase().includes("<html") ? "html" : "xml";
  }
  return "text";
}
function M(r) {
  if (r.comment) return r.comment;
  try {
    const o = new URL(r.request.url), e = o.pathname.replace(/\/$/, "").split("/").filter(Boolean), i = e.length > 0 ? e[e.length - 1] : o.hostname;
    return `${r.request.method} ${i}`;
  } catch {
    return `${r.request.method} ${r.request.url.slice(0, 30)}`;
  }
}
const K = async (r) => {
  const o = z(), t = r.request, e = [], i = (t.method || "GET").toUpperCase(), a = {
    type: "request",
    content: [
      o.createMethodNode(i),
      o.createUrlNode(t.url)
    ]
  };
  e.push(a);
  const c = [], n = (t.headers || []).some(
    (s) => s.name.toLowerCase() === "cookie"
  );
  if (t.headers && t.headers.length > 0) {
    for (const s of t.headers)
      if (s.name && s.value !== void 0) {
        if (s.name.startsWith(":")) continue;
        c.push([s.name, s.value]);
      }
  }
  if (!n && t.cookies && t.cookies.length > 0) {
    const s = t.cookies.map((u) => `${u.name}=${u.value}`).join("; ");
    c.push(["Cookie", s]);
  }
  if (c.length > 0 && e.push(o.createHeadersTableNode(c)), t.queryString && t.queryString.length > 0) {
    const s = t.queryString.map((u) => [
      u.name,
      u.value || ""
    ]);
    e.push(o.createQueryTableNode(s));
  }
  if (t.postData) {
    const s = t.postData, u = (s.mimeType || "").toLowerCase();
    if (u.includes("application/x-www-form-urlencoded") && s.params && s.params.length > 0) {
      const p = s.params.map((d) => [
        d.name,
        d.value || ""
      ]);
      e.push(o.createUrlTableNode(p));
    } else if (u.includes("multipart/form-data") && s.params && s.params.length > 0) {
      const p = s.params.map((d) => [
        d.name,
        d.value || d.fileName || ""
      ]);
      e.push(o.createMultipartTableNode(p));
    } else if (s.text) {
      const p = G(s);
      p === "json" ? e.push(o.createJsonBodyNode(s.text, "json")) : p === "xml" ? e.push(o.createXMLBodyNode(s.text, "xml")) : p === "html" ? e.push(o.createXMLBodyNode(s.text, "html")) : e.push(o.createJsonBodyNode(s.text, "text"));
    }
  }
  const l = M(r);
  return o.convertBlocksToVoidFile(l, e);
};
function Z(r, o = !0) {
  var i, a, c;
  const t = {}, e = /* @__PURE__ */ new Map();
  if (r.pages && r.pages.length > 0)
    for (const n of r.pages)
      e.set(n.id, j(n.title || n.id));
  for (const n of r.entries) {
    if (!n.request || !n.request.url) continue;
    if (o) {
      const s = ((a = (i = n.response) == null ? void 0 : i.content) == null ? void 0 : a.mimeType) || ((c = n.request.postData) == null ? void 0 : c.mimeType);
      if (J(n.request.url, s))
        continue;
    }
    let l = "general-requests";
    if (n.pageref && e.has(n.pageref))
      l = e.get(n.pageref);
    else
      try {
        const s = new URL(n.request.url);
        l = j(s.hostname) || "general-requests";
      } catch {
        l = "general-requests";
      }
    t[l] || (t[l] = []), t[l].push(n);
  }
  return t;
}
const Y = async (r, o) => {
  var a, c, n, l;
  const t = await K(r), e = j(M(r)), i = await ((c = (a = window.electron) == null ? void 0 : a.files) == null ? void 0 : c.createVoid(
    o,
    e
  ));
  i != null && i.path && await ((l = (n = window.electron) == null ? void 0 : n.files) == null ? void 0 : l.write(i.path, t));
}, ee = async (r, o, t = {}, e, i, a) => {
  var k, S, _, A, N;
  const c = JSON.parse(r), n = Q(c) ? c.log : c;
  if (!n || !Array.isArray(n.entries))
    throw new Error("Invalid HAR file format: missing log entries");
  const l = t.ignoreStaticAssets ?? !0, s = Z(n, l);
  let u = 0;
  for (const g in s)
    u += s[g].length;
  if (u === 0)
    return {
      success: !0,
      message: "No requests found to import (check static asset filter settings)."
    };
  const p = j(
    (k = n.creator) != null && k.name ? `har-${n.creator.name}` : "har-import"
  ), d = await ((_ = (S = window.electron) == null ? void 0 : S.files) == null ? void 0 : _.createDirectory(
    o,
    p
  )) || p, v = `${o}/${d}`;
  let b = 0;
  for (const g in s) {
    if (a != null && a.cancelled) return;
    const m = s[g], x = await ((N = (A = window.electron) == null ? void 0 : A.files) == null ? void 0 : N.createDirectory(
      v,
      g
    )) || g, h = `${v}/${x}`;
    for (const w of m) {
      if (a != null && a.cancelled) return;
      const q = M(w);
      try {
        await Y(w, h);
      } catch (f) {
        i == null || i(q, f);
      } finally {
        b++, e == null || e(b, u);
      }
      await new Promise((f) => setTimeout(f, 15));
    }
  }
  return {
    success: !0,
    message: `Imported ${b} requests successfully`
  };
}, te = window.__voiden_shims__["lucide-react"] || {}, { AlertCircle: Ze, ArrowDown: Ye, ArrowDownLeft: et, ArrowLeft: tt, ArrowLeftRight: rt, ArrowRight: ot, ArrowUp: st, ArrowUpRight: nt, BookOpen: it, Check: at, CheckCheck: ct, ChevronDown: lt, ChevronRight: ut, ChevronsDownUp: dt, ChevronsUpDown: pt, Circle: mt, CircleAlert: ft, CircleX: ht, Clock: gt, Columns2: wt, Copy: yt, CornerDownLeft: vt, CornerDownRight: xt, Download: bt, ExternalLink: Ct, Eye: It, FileDown: Tt, FileText: kt, Folder: St, FolderOpen: _t, History: At, Info: Nt, Link: qt, Loader: Et, Loader2: Pt, Mouse: jt, Pen: Ht, Pencil: Rt, Play: Lt, Plus: Mt, Radio: Dt, RefreshCw: $t, Rows: Ot, Search: Ut, SkipForward: Ft, Sparkles: Vt, Square: Bt, Trash2: Qt, Unlink: Wt, Wifi: Xt, WifiOff: Jt, WrapText: zt, X: re, XCircle: oe } = te, P = /* @__PURE__ */ new Map(), R = /* @__PURE__ */ new Map(), se = ({ tab: r, showToast: o }) => {
  const t = P.get(r.tabId), [e, i] = I((t == null ? void 0 : t.progress) ?? { current: 0, total: 0 }), [a, c] = I((t == null ? void 0 : t.isImporting) ?? !1), [n, l] = I((t == null ? void 0 : t.error) ?? null), [s, u] = I((t == null ? void 0 : t.ignoreStaticAssets) ?? !0), [p, d] = I(!1), v = F(null);
  D(() => {
    P.set(r.tabId, { isImporting: a, progress: e, error: n, ignoreStaticAssets: s });
  }, [r.tabId, a, e, n, s]);
  const b = B();
  D(() => {
    if (n) {
      d(!0);
      const m = setTimeout(() => {
        d(!1);
        const x = setTimeout(() => l(null), 300);
        return () => clearTimeout(x);
      }, 5e3);
      return () => clearTimeout(m);
    }
  }, [n]);
  const k = () => {
    v.current && (v.current.cancelled = !0), c(!1), i({ current: 0, total: 0 }), P.delete(r.tabId), R.delete(r.tabId);
  }, S = async () => {
    var m, x;
    try {
      l(null), d(!1), c(!0), i({ current: 0, total: 0 });
      const h = { cancelled: !1 };
      v.current = h, R.set(r.tabId, h);
      const w = b.getQueryData(["projects"]), q = w == null ? void 0 : w.activeProject;
      if (!q) {
        l("No active project found"), c(!1);
        return;
      }
      let f = r.content;
      if ((!f || f.trim() === "") && r.source && (f = await ((x = (m = window.electron) == null ? void 0 : m.files) == null ? void 0 : x.read(r.source)) ?? ""), !f || f.trim() === "") {
        l("HAR file content is empty"), c(!1);
        return;
      }
      try {
        JSON.parse(f);
      } catch {
        l("Invalid HAR JSON format"), c(!1);
        return;
      }
      const E = await ee(
        f,
        q,
        { ignoreStaticAssets: s },
        (H, C) => {
          i({ current: H, total: C });
        },
        (H, C) => {
          const U = C instanceof Error ? C.message : String(C);
          o == null || o(`Failed to import "${H}": ${U}`, "error");
        },
        h
      );
      if (h.cancelled) return;
      E != null && E.message && o && o(E.message, "success"), i({ current: 0, total: 0 }), c(!1), P.delete(r.tabId), R.delete(r.tabId);
    } catch (h) {
      console.error("Failed to import HAR file:", h);
      const w = h instanceof Error ? h.message : "Failed to import HAR file";
      l(w), i({ current: 0, total: 0 }), c(!1);
    }
  }, _ = () => {
    d(!1), setTimeout(() => l(null), 300);
  }, A = () => a && e.current > 0 && e.current < e.total ? `Generating files... ${e.current}/${e.total}` : e.current === e.total && e.total > 0 ? `Generated ${e.total} files` : "Generate Voiden files", N = () => {
    const m = "px-2 py-0.5 rounded-sm text-sm transition-all duration-200";
    return a && e.current > 0 && e.current < e.total ? `${m} bg-yellow-500 hover:bg-yellow-600 text-black cursor-wait` : e.current === e.total && e.total > 0 ? `${m} bg-green-500 hover:bg-green-600 text-white` : `${m} bg-panel hover:bg-active text-foreground`;
  }, g = a && e.current > 0 && e.current < e.total;
  return /* @__PURE__ */ T("div", { className: "flex flex-col gap-1", children: [
    !n && /* @__PURE__ */ T("div", { className: "flex items-center gap-3", children: [
      /* @__PURE__ */ y(
        "button",
        {
          className: N(),
          onClick: S,
          disabled: g,
          title: g ? "Import in progress..." : "Import HAR file",
          children: A()
        }
      ),
      /* @__PURE__ */ T("label", { className: "flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none", children: [
        /* @__PURE__ */ y(
          "input",
          {
            type: "checkbox",
            checked: s,
            onChange: (m) => u(m.target.checked),
            disabled: g,
            className: "rounded border-gray-400 text-primary focus:ring-primary"
          }
        ),
        "Ignore static assets"
      ] }),
      a && /* @__PURE__ */ y(
        "button",
        {
          onClick: k,
          title: "Cancel",
          className: "text-muted hover:text-red-500 transition-colors",
          children: /* @__PURE__ */ y(oe, { size: 15 })
        }
      ),
      a && e.current > 0 && e.total > 0 && /* @__PURE__ */ T("div", { className: "text-xs text-gray-500", children: [
        Math.round(e.current / e.total * 100),
        "%"
      ] })
    ] }),
    n && /* @__PURE__ */ y(
      "div",
      {
        className: `transition-all duration-300 overflow-hidden ${p ? "max-h-20 opacity-100" : "max-h-0 opacity-0"}`,
        children: /* @__PURE__ */ T("div", { className: "flex items-center justify-between border border-red-200 rounded px-2 py-1", children: [
          /* @__PURE__ */ y("span", { className: "text-red-600 dark:text-red-400 text-xs", children: n }),
          /* @__PURE__ */ y(
            "button",
            {
              onClick: _,
              className: "text-red-500 hover:text-red-700 text-xs ml-2",
              title: "Dismiss error",
              children: /* @__PURE__ */ y(re, { size: 12 })
            }
          )
        ] })
      }
    )
  ] });
}, Gt = (r) => {
  var t;
  const o = (t = r == null ? void 0 : r.ui) == null ? void 0 : t.showToast;
  return {
    onload: () => {
      r.registerEditorAction({
        id: "har-import-button",
        component: (e) => O.createElement(se, {
          ...e,
          showToast: o
        }),
        predicate: (e) => {
          if (!e || !e.title) return !1;
          const i = e.title.toLowerCase();
          return i.endsWith(".har") ? !0 : i.endsWith(".json") && e.content ? e.content.indexOf('"log"') > -1 && e.content.indexOf('"entries"') > -1 : !1;
        }
      });
    },
    onunload: () => {
    }
  };
};
export {
  se as HarImportButton,
  ne as __voiden_bundle_version__,
  ie as __voiden_manifest__,
  K as convertHarEntryToVoidenSchema,
  Y as createSingleHarFile,
  Gt as default,
  M as getEntryName,
  Z as groupEntries,
  ee as importHarLog,
  Q as isHarObject,
  J as isStaticAsset,
  j as sanitizeName
};
