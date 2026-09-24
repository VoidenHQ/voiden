const oe = 2, ae = { id: "jwt-faker", name: "JWT Faker", description: "Generate, customize, sign, decode, and copy JSON Web Tokens (JWTs) directly within Voiden for testing authenticated APIs with support for HS256, HS384, HS512, and unsigned tokens.", version: "1.0.0", voidenVersion: ">=2.0.0", author: "Voiden Team", enabled: !0, priority: 50, readme: "Generate and decode JWTs for testing authenticated APIs. Supports HS256, HS384, HS512, unsigned tokens (alg: none), custom payload/header editors, expiration/issued-at claim helpers, template saving, and one-click copy.", capabilities: { ui: { buttons: [{ id: "jwt-faker-btn", location: "sidebar-left", icon: "Sparkles", tooltip: "JWT Faker", description: "Opens JWT Faker dialog to generate and decode test JWTs" }], description: "Adds JWT Faker generator to UI toolbar and editor actions" } }, dependencies: { core: "^1.0.0", sdk: "^1.0.0" }, features: ["Generate JWTs using HMAC SHA algorithms: HS256, HS384, HS512", "Generate unsigned tokens (alg: none) for testing", "Custom JSON payload editor with validation", "Custom JSON header editor", "Quick claim helpers for exp (expiration), iat (issued-at), nbf (not-before)", "Live preview of encoded and decoded JWT components (Header, Payload, Signature)", "One-click copy of generated JWT token string", "Save and manage reusable JWT claim templates"] }, L = window.__voiden_shims__.react, {
  useState: u,
  useEffect: j,
  useCallback: de,
  useMemo: ie,
  useRef: se,
  useContext: le,
  createContext: ce,
  forwardRef: ue,
  memo: me,
  Fragment: pe,
  createElement: ge,
  cloneElement: fe,
  Children: be,
  StrictMode: he,
  Suspense: xe,
  lazy: ye,
  isValidElement: ve,
  Component: we,
  PureComponent: Ne,
  createRef: Se,
  startTransition: ke,
  useReducer: Ce,
  useLayoutEffect: _e,
  useImperativeHandle: Je,
  useDebugValue: He,
  useTransition: Te,
  useDeferredValue: Ae,
  useId: Oe
} = L, T = window.__voiden_shims__["react/jsx-runtime"], e = T.jsx, o = T.jsxs, z = T.Fragment;
function H(a) {
  let d = "";
  if (typeof a == "string") {
    const n = new TextEncoder().encode(a);
    let s = "";
    for (let i = 0; i < n.byteLength; i++)
      s += String.fromCharCode(n[i]);
    d = btoa(s);
  } else {
    let t = "";
    for (let n = 0; n < a.byteLength; n++)
      t += String.fromCharCode(a[n]);
    d = btoa(t);
  }
  return d.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function P(a) {
  let d = a.replace(/-/g, "+").replace(/_/g, "/");
  for (; d.length % 4 !== 0; )
    d += "=";
  const t = atob(d), n = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++)
    n[i] = t.charCodeAt(i);
  return new TextDecoder().decode(n);
}
function B(a) {
  switch (a) {
    case "HS256":
      return "SHA-256";
    case "HS384":
      return "SHA-384";
    case "HS512":
      return "SHA-512";
    default:
      throw new Error(`Unsupported HMAC algorithm: ${a}`);
  }
}
async function K(a, d, t) {
  const n = B(a), s = new TextEncoder(), i = s.encode(d), c = await crypto.subtle.importKey(
    "raw",
    i,
    { name: "HMAC", hash: { name: n } },
    !1,
    ["sign"]
  ), l = await crypto.subtle.sign(
    "HMAC",
    c,
    s.encode(t)
  );
  return H(new Uint8Array(l));
}
async function q(a, d, t, n = "HS256") {
  const s = {
    ...a,
    typ: a.typ || "JWT",
    alg: n
  }, i = H(JSON.stringify(s)), c = H(JSON.stringify(d)), l = `${i}.${c}`;
  if (n === "none")
    return `${l}.`;
  if (!t)
    throw new Error(`Secret key is required for ${n} signing`);
  const h = await K(n, t, l);
  return `${l}.${h}`;
}
function X(a) {
  if (!a || typeof a != "string")
    return {
      header: { alg: "none", typ: "JWT" },
      payload: {},
      signature: "",
      rawHeader: "",
      rawPayload: "",
      isValid: !1,
      error: "Token string is empty"
    };
  const d = a.trim().split(".");
  if (d.length < 2 || d.length > 3)
    return {
      header: { alg: "none", typ: "JWT" },
      payload: {},
      signature: "",
      rawHeader: "",
      rawPayload: "",
      isValid: !1,
      error: "Invalid JWT format: must contain header, payload, and signature sections"
    };
  try {
    const t = P(d[0]), n = P(d[1]), s = d[2] || "", i = JSON.parse(t), c = JSON.parse(n);
    return {
      header: i,
      payload: c,
      signature: s,
      rawHeader: t,
      rawPayload: n,
      isValid: !0
    };
  } catch (t) {
    const n = t instanceof Error ? t.message : String(t);
    return {
      header: { alg: "none", typ: "JWT" },
      payload: {},
      signature: d[2] || "",
      rawHeader: d[0] || "",
      rawPayload: d[1] || "",
      isValid: !1,
      error: `Failed to decode JWT: ${n}`
    };
  }
}
function C(a = 0) {
  return Math.floor(Date.now() / 1e3) + a;
}
const Q = window.__voiden_shims__["lucide-react"] || {}, { AlertCircle: De, ArrowDown: We, ArrowDownLeft: Ee, ArrowLeft: Fe, ArrowLeftRight: je, ArrowRight: Pe, ArrowUp: Re, ArrowUpRight: Le, BookOpen: Ie, Check: Y, CheckCheck: Me, ChevronDown: $e, ChevronRight: Ue, ChevronsDownUp: Ve, ChevronsUpDown: Ge, Circle: ze, CircleAlert: Be, CircleX: Ke, Clock: qe, Columns2: Xe, Copy: Z, CornerDownLeft: Qe, CornerDownRight: Ye, Download: Ze, ExternalLink: et, Eye: tt, FileDown: rt, FileText: nt, Folder: ot, FolderOpen: at, History: dt, Info: it, Link: st, Loader: lt, Loader2: ct, Mouse: ut, Pen: mt, Pencil: pt, Play: gt, Plus: ft, Radio: bt, RefreshCw: ht, Rows: xt, Search: yt, SkipForward: vt, Sparkles: ee, Square: wt, Trash2: Nt, Unlink: St, Wifi: kt, WifiOff: Ct, WrapText: _t, X: R, XCircle: Jt } = Q, te = JSON.stringify({ alg: "HS256", typ: "JWT" }, null, 2), re = JSON.stringify(
  {
    sub: "123456789",
    name: "John Doe",
    email: "john@example.com",
    role: "admin",
    iat: Math.floor(Date.now() / 1e3),
    exp: Math.floor(Date.now() / 1e3) + 3600
  },
  null,
  2
), ne = ({ isOpen: a, onClose: d, showToast: t }) => {
  const [n, s] = u("HS256"), [i, c] = u("your-256-bit-secret"), [l, h] = u(te), [b, _] = u(re), [p, I] = u(""), [A, O] = u(!1), [g, x] = u("editor"), [J, D] = u(""), [W, y] = u(null), [f, E] = u(() => {
    try {
      const r = localStorage.getItem("__voiden_jwt_templates__");
      return r ? JSON.parse(r) : [];
    } catch {
      return [];
    }
  }), [v, F] = u("");
  if (j(() => {
    try {
      localStorage.setItem("__voiden_jwt_templates__", JSON.stringify(f));
    } catch {
    }
  }, [f]), j(() => {
    let r = !0;
    return (async () => {
      try {
        y(null);
        let m = {}, k = {};
        try {
          m = JSON.parse(l);
        } catch {
          y("Invalid JSON in Header");
          return;
        }
        try {
          k = JSON.parse(b);
        } catch {
          y("Invalid JSON in Payload");
          return;
        }
        const G = await q(m, k, i, n);
        r && I(G);
      } catch (m) {
        if (r) {
          const k = m instanceof Error ? m.message : String(m);
          y(k);
        }
      }
    })(), () => {
      r = !1;
    };
  }, [n, i, l, b]), !a) return null;
  const M = () => {
    p && (navigator.clipboard.writeText(p), O(!0), t == null || t("JWT copied to clipboard!", "success"), setTimeout(() => O(!1), 2e3));
  }, w = (r, S) => {
    try {
      const m = JSON.parse(b || "{}");
      m[r] = S, _(JSON.stringify(m, null, 2));
    } catch {
    }
  }, $ = () => {
    if (!v.trim()) return;
    const r = {
      id: Date.now().toString(),
      name: v.trim(),
      algorithm: n,
      secret: i,
      header: l,
      payload: b
    };
    E([...f, r]), F(""), t == null || t(`Saved template "${r.name}"`, "success");
  }, U = (r) => {
    s(r.algorithm), c(r.secret), h(r.header), _(r.payload), x("editor"), t == null || t(`Loaded template "${r.name}"`, "info");
  }, V = (r) => {
    E(f.filter((S) => S.id !== r));
  }, N = X(g === "decoder" && J || p);
  return /* @__PURE__ */ e("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4", children: /* @__PURE__ */ o("div", { className: "bg-panel border border-border rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col text-foreground overflow-hidden", children: [
    /* @__PURE__ */ o("div", { className: "flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20", children: [
      /* @__PURE__ */ o("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ e(ee, { className: "w-5 h-5 text-yellow-500" }),
        /* @__PURE__ */ e("h2", { className: "text-base font-semibold", children: "JWT Faker & Generator" })
      ] }),
      /* @__PURE__ */ o("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ o("div", { className: "flex bg-muted/40 rounded p-0.5 text-xs", children: [
          /* @__PURE__ */ e(
            "button",
            {
              className: `px-3 py-1 rounded transition-colors ${g === "editor" ? "bg-primary text-primary-foreground font-medium" : "text-muted hover:text-foreground"}`,
              onClick: () => x("editor"),
              children: "Generator"
            }
          ),
          /* @__PURE__ */ e(
            "button",
            {
              className: `px-3 py-1 rounded transition-colors ${g === "decoder" ? "bg-primary text-primary-foreground font-medium" : "text-muted hover:text-foreground"}`,
              onClick: () => {
                x("decoder"), J || D(p);
              },
              children: "Decoder"
            }
          ),
          /* @__PURE__ */ o(
            "button",
            {
              className: `px-3 py-1 rounded transition-colors ${g === "templates" ? "bg-primary text-primary-foreground font-medium" : "text-muted hover:text-foreground"}`,
              onClick: () => x("templates"),
              children: [
                "Templates (",
                f.length,
                ")"
              ]
            }
          )
        ] }),
        /* @__PURE__ */ e("button", { onClick: d, className: "p-1 text-muted hover:text-foreground rounded", children: /* @__PURE__ */ e(R, { size: 18 }) })
      ] })
    ] }),
    /* @__PURE__ */ o("div", { className: "flex-1 overflow-y-auto p-4 space-y-4", children: [
      g === "editor" && /* @__PURE__ */ o(z, { children: [
        /* @__PURE__ */ o("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [
          /* @__PURE__ */ o("div", { children: [
            /* @__PURE__ */ e("label", { className: "block text-xs font-medium text-muted mb-1", children: "Algorithm" }),
            /* @__PURE__ */ o(
              "select",
              {
                value: n,
                onChange: (r) => s(r.target.value),
                className: "w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm focus:ring-1 focus:ring-primary",
                children: [
                  /* @__PURE__ */ e("option", { value: "HS256", children: "HS256 (HMAC SHA-256)" }),
                  /* @__PURE__ */ e("option", { value: "HS384", children: "HS384 (HMAC SHA-384)" }),
                  /* @__PURE__ */ e("option", { value: "HS512", children: "HS512 (HMAC SHA-512)" }),
                  /* @__PURE__ */ e("option", { value: "none", children: "none (Unsigned Token)" })
                ]
              }
            )
          ] }),
          /* @__PURE__ */ o("div", { children: [
            /* @__PURE__ */ o("label", { className: "block text-xs font-medium text-muted mb-1", children: [
              "Secret Key ",
              n === "none" && "(Not required for unsigned)"
            ] }),
            /* @__PURE__ */ e(
              "input",
              {
                type: "text",
                value: i,
                onChange: (r) => c(r.target.value),
                disabled: n === "none",
                placeholder: "Enter signing secret",
                className: "w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm disabled:opacity-50 focus:ring-1 focus:ring-primary"
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ o("div", { className: "flex flex-wrap items-center gap-2 text-xs", children: [
          /* @__PURE__ */ e("span", { className: "text-muted font-medium", children: "Quick Claims:" }),
          /* @__PURE__ */ e(
            "button",
            {
              onClick: () => w("exp", C(3600)),
              className: "px-2 py-1 bg-muted/40 hover:bg-muted/70 rounded text-foreground transition-colors",
              children: "+1h Exp"
            }
          ),
          /* @__PURE__ */ e(
            "button",
            {
              onClick: () => w("exp", C(86400)),
              className: "px-2 py-1 bg-muted/40 hover:bg-muted/70 rounded text-foreground transition-colors",
              children: "+1d Exp"
            }
          ),
          /* @__PURE__ */ e(
            "button",
            {
              onClick: () => w("iat", C(0)),
              className: "px-2 py-1 bg-muted/40 hover:bg-muted/70 rounded text-foreground transition-colors",
              children: "Set iat Now"
            }
          ),
          /* @__PURE__ */ e(
            "button",
            {
              onClick: () => w("nbf", C(0)),
              className: "px-2 py-1 bg-muted/40 hover:bg-muted/70 rounded text-foreground transition-colors",
              children: "Set nbf Now"
            }
          )
        ] }),
        /* @__PURE__ */ o("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [
          /* @__PURE__ */ o("div", { children: [
            /* @__PURE__ */ e("div", { className: "flex items-center justify-between mb-1", children: /* @__PURE__ */ e("label", { className: "text-xs font-medium text-muted", children: "Header (JSON)" }) }),
            /* @__PURE__ */ e(
              "textarea",
              {
                rows: 6,
                value: l,
                onChange: (r) => h(r.target.value),
                className: "w-full font-mono text-xs bg-input border border-border rounded p-2 focus:ring-1 focus:ring-primary"
              }
            )
          ] }),
          /* @__PURE__ */ o("div", { children: [
            /* @__PURE__ */ e("div", { className: "flex items-center justify-between mb-1", children: /* @__PURE__ */ e("label", { className: "text-xs font-medium text-muted", children: "Payload (JSON)" }) }),
            /* @__PURE__ */ e(
              "textarea",
              {
                rows: 6,
                value: b,
                onChange: (r) => _(r.target.value),
                className: "w-full font-mono text-xs bg-input border border-border rounded p-2 focus:ring-1 focus:ring-primary"
              }
            )
          ] })
        ] }),
        W && /* @__PURE__ */ e("div", { className: "text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded px-2.5 py-1.5", children: W }),
        /* @__PURE__ */ o("div", { children: [
          /* @__PURE__ */ o("div", { className: "flex items-center justify-between mb-1", children: [
            /* @__PURE__ */ e("label", { className: "text-xs font-semibold text-foreground", children: "Generated Encoded JWT" }),
            /* @__PURE__ */ o(
              "button",
              {
                onClick: M,
                disabled: !p,
                className: "flex items-center gap-1.5 px-2.5 py-1 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded transition-colors",
                children: [
                  A ? /* @__PURE__ */ e(Y, { size: 14 }) : /* @__PURE__ */ e(Z, { size: 14 }),
                  A ? "Copied!" : "Copy JWT"
                ]
              }
            )
          ] }),
          /* @__PURE__ */ e(
            "textarea",
            {
              readOnly: !0,
              rows: 3,
              value: p,
              className: "w-full font-mono text-xs bg-muted/20 border border-border rounded p-2 text-yellow-500 select-all"
            }
          )
        ] }),
        /* @__PURE__ */ o("div", { className: "flex items-center gap-2 pt-2 border-t border-border", children: [
          /* @__PURE__ */ e(
            "input",
            {
              type: "text",
              placeholder: "Template name (e.g. Admin Token)",
              value: v,
              onChange: (r) => F(r.target.value),
              className: "flex-1 bg-input border border-border rounded px-2.5 py-1 text-xs"
            }
          ),
          /* @__PURE__ */ e(
            "button",
            {
              onClick: $,
              disabled: !v.trim(),
              className: "px-3 py-1 bg-muted hover:bg-muted/80 text-xs font-medium rounded transition-colors disabled:opacity-50",
              children: "Save as Template"
            }
          )
        ] })
      ] }),
      g === "decoder" && /* @__PURE__ */ o("div", { className: "space-y-4", children: [
        /* @__PURE__ */ o("div", { children: [
          /* @__PURE__ */ e("label", { className: "block text-xs font-medium text-muted mb-1", children: "JWT Token to Decode" }),
          /* @__PURE__ */ e(
            "textarea",
            {
              rows: 3,
              value: J,
              onChange: (r) => D(r.target.value),
              placeholder: "Paste JWT token here...",
              className: "w-full font-mono text-xs bg-input border border-border rounded p-2"
            }
          )
        ] }),
        N.isValid ? /* @__PURE__ */ o("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [
          /* @__PURE__ */ o("div", { children: [
            /* @__PURE__ */ e("span", { className: "block text-xs font-semibold text-red-400 mb-1", children: "Decoded Header" }),
            /* @__PURE__ */ e("pre", { className: "font-mono text-xs bg-muted/20 border border-border rounded p-2 overflow-x-auto text-red-400", children: JSON.stringify(N.header, null, 2) })
          ] }),
          /* @__PURE__ */ o("div", { children: [
            /* @__PURE__ */ e("span", { className: "block text-xs font-semibold text-purple-400 mb-1", children: "Decoded Payload" }),
            /* @__PURE__ */ e("pre", { className: "font-mono text-xs bg-muted/20 border border-border rounded p-2 overflow-x-auto text-purple-400", children: JSON.stringify(N.payload, null, 2) })
          ] })
        ] }) : /* @__PURE__ */ e("div", { className: "text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2", children: N.error || "Invalid token structure" })
      ] }),
      g === "templates" && /* @__PURE__ */ e("div", { className: "space-y-3", children: f.length === 0 ? /* @__PURE__ */ e("div", { className: "text-xs text-muted text-center py-6", children: 'No saved templates yet. Customize claims in the Generator and click "Save as Template".' }) : f.map((r) => /* @__PURE__ */ o(
        "div",
        {
          className: "flex items-center justify-between p-2.5 border border-border rounded bg-muted/10 hover:bg-muted/20",
          children: [
            /* @__PURE__ */ o("div", { children: [
              /* @__PURE__ */ e("div", { className: "text-xs font-semibold text-foreground", children: r.name }),
              /* @__PURE__ */ o("div", { className: "text-[11px] text-muted", children: [
                "Alg: ",
                r.algorithm,
                " | Key: ",
                r.secret || "(none)"
              ] })
            ] }),
            /* @__PURE__ */ o("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ e(
                "button",
                {
                  onClick: () => U(r),
                  className: "px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90",
                  children: "Load"
                }
              ),
              /* @__PURE__ */ e(
                "button",
                {
                  onClick: () => V(r.id),
                  className: "p-1 text-muted hover:text-red-500",
                  children: /* @__PURE__ */ e(R, { size: 14 })
                }
              )
            ] })
          ]
        },
        r.id
      )) })
    ] })
  ] }) });
}, Ht = (a) => {
  var i;
  const d = (i = a == null ? void 0 : a.ui) == null ? void 0 : i.showToast;
  let t = null, n = !1;
  const s = () => {
    var l;
    t || (t = document.createElement("div"), t.id = "jwt-faker-modal-root", document.body.appendChild(t));
    const { createRoot: c } = ((l = window.__voiden_shims__) == null ? void 0 : l["react-dom/client"]) || {};
    c && (t._reactRoot || (t._reactRoot = c(t)), t._reactRoot.render(
      L.createElement(ne, {
        isOpen: n,
        onClose: () => {
          n = !1, s();
        },
        showToast: d
      })
    ));
  };
  return {
    onload: () => {
      window.__voidenOpenJwtFaker__ = () => {
        n = !0, s();
      }, typeof a.registerStatusBarItem == "function" && a.registerStatusBarItem({
        id: "jwt-faker-status-item",
        text: "JWT Faker",
        icon: "Sparkles",
        tooltip: "Generate and decode JWT tokens for testing",
        onClick: () => {
          n = !0, s();
        }
      });
    },
    onunload: () => {
      delete window.__voidenOpenJwtFaker__, t && (t._reactRoot && t._reactRoot.unmount(), t.remove(), t = null);
    }
  };
};
export {
  ne as JwtFakerModal,
  oe as __voiden_bundle_version__,
  ae as __voiden_manifest__,
  P as base64urlDecode,
  H as base64urlEncode,
  X as decodeJwt,
  Ht as default,
  q as generateJwt,
  C as getClaimTimestamp,
  K as signHmac
};
