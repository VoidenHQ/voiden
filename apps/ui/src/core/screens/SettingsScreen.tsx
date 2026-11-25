import { useSettings, ProxyConfig, SYSTEM_DEFAULT_FONT, VALID_FONT_FAMILIES } from "@/core/settings/hooks/useSettings";
import { Check, RefreshCw, Plus, Trash2, Edit2, Palette, FileText, Network, Search, Keyboard, ChevronUp, ChevronDown, Settings, Plug, Code2, Sparkles, Download, Copy, RotateCcw, X, ShieldCheck, FolderOpen, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePluginStore, type PluginSettingsSection } from "@/plugins";
import { loadThemeById, getAvailableThemes } from "@/utils/themeLoader";
import { Kbd } from "@/core/components/ui/kbd";
import { CliCommandMessage, type CliResultMessage } from "@/core/settings/components/CliCommandMessage";
import { useTerminalShells } from "@/core/terminal/hooks";
import { useSidebarTabsPosition, type SidebarTabsPosition } from "@/core/stores/sidebarTabsPosition";
import { useGetProjects } from "@/core/projects/hooks/useProjects";

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 20;
const UI_FONT_SIZE_MIN = 10;
const UI_FONT_SIZE_MAX = 16;
const AUTO_SAVE_DELAY_MIN = 0;
const AUTO_SAVE_DELAY_MAX = 300;
const CONTENT_WIDTH_MIN = 600;
const CONTENT_WIDTH_MAX = 1400;

type RowProps = {
  title: string;
  description: string;
  control: React.ReactNode;
  border?: boolean;
};

const Row = ({ title, description, control, border = true }: RowProps) => (
  <div className={`flex items-center justify-between gap-6 px-4 py-3.5 ${border ? 'border-b border-border-subtle' : ''}`}>
    <div className="flex-1 min-w-0">
      <div className="text-sm text-text">{title}</div>
      {description && <div className="text-xs text-comment mt-0.5 leading-relaxed">{description}</div>}
    </div>
    <div className="flex-shrink-0">{control}</div>
  </div>
);

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg overflow-hidden bg-surface">
    {children}
  </div>
);

const GroupLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-xs text-comment mt-5 mb-2 px-1">{children}</div>
);

const Toggle = ({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <button
    onClick={() => !disabled && onChange(!checked)}
    disabled={disabled}
    className={`relative h-5 w-9 rounded-full transition ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    style={{
      backgroundColor: checked ? 'var(--icon-primary)' : 'rgb(107 114 128)'
    }}
    aria-pressed={checked}
  >
    <span
      className={`absolute top-0.5 h-4 w-4 rounded-full bg-editor shadow transform transition ${
        checked ? "translate-x-0" : "translate-x-[-1rem]"
      }`}
    />
  </button>
);

const Select = ({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    {...props}
    className={`px-2.5 py-1 rounded-md bg-editor text-text text-sm border border-border-subtle focus:outline-none focus:ring-1 focus:ring-[var(--icon-primary)] min-w-[160px] ${className}`}
  />
);

const Input = ({ className = "", style, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`px-3 py-1.5 rounded-md bg-editor text-text text-sm border border-border-subtle focus:outline-none focus:ring-1 ${className}`}
    style={{
      '--tw-ring-color': 'var(--icon-primary)',
      ...style,
    } as React.CSSProperties}
  />
);

// ── Client certificates (mTLS, #634) ──────────────────────────────────────────
// Edits the active project's .voiden/certificates.yaml through the main process.

type CertForm = {
  name: string;
  hosts: string;
  type: "pem" | "pfx";
  cert: string;
  key: string;
  pfx: string;
  ca: string;
  passphrase: string;
};

const EMPTY_CERT_FORM: CertForm = { name: "", hosts: "", type: "pem", cert: "", key: "", pfx: "", ca: "", passphrase: "" };

const RESERVED_CERT_NAMES = ["auto", "none"];

/** Starts like `{{NAME}}`: a variable from the active environment, not a secret, so it stays readable (also while typing). */
const isVariableReference = (value: string) => value.trimStart().startsWith("{{");

type CertCheck =
  | { ok: true; subject?: string; issuer?: string; validTo?: string; expired?: boolean }
  | { ok: false; error: string };

type CertList = Awaited<ReturnType<NonNullable<typeof window.electron>["clientCertificates"]["list"]>>;

const toForm = (p: ClientCertificateProfile): CertForm => ({
  name: p.name,
  hosts: p.hosts.join(", "),
  type: p.pfx ? "pfx" : "pem",
  cert: p.cert ?? "",
  key: p.key ?? "",
  pfx: p.pfx ?? "",
  ca: p.ca ?? "",
  passphrase: p.passphrase ?? "",
});

/** `https://localhost:8443/hello` → `localhost:8443`: a host pattern is host[:port] only. */
const toHostPattern = (h: string) =>
  h.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^[^/?#@]*@/, "").split(/[/?#]/)[0];

const toProfile = (f: CertForm): ClientCertificateProfile => {
  const v = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    name: f.name.trim(),
    hosts: f.hosts.split(",").map(toHostPattern).filter(Boolean),
    ...(f.type === "pem" ? { cert: v(f.cert), key: v(f.key) } : { pfx: v(f.pfx) }),
    ca: v(f.ca),
    passphrase: f.passphrase ? f.passphrase : undefined,
  };
};

/** A settings-style row whose control sits below the title (for wide inputs like paths). */
const FieldRow = ({
  title,
  description,
  error,
  border = true,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  error?: string;
  border?: boolean;
  children: React.ReactNode;
}) => (
  <div className={`px-4 py-3.5 ${border ? "border-b border-border-subtle" : ""}`}>
    <div className="text-sm text-text">{title}</div>
    {description && <div className="text-xs text-comment mt-0.5 leading-relaxed">{description}</div>}
    <div className="mt-2.5">{children}</div>
    {error && (
      <div className="flex items-center gap-1 text-xs mt-1.5" style={{ color: "var(--icon-error)" }}>
        <AlertCircle className="w-3 h-3 flex-shrink-0" />
        {error}
      </div>
    )}
  </div>
);

const FilePicker = ({
  value,
  onChange,
  extensions,
  defaultPath,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  extensions: string[];
  defaultPath?: string;
  invalid?: boolean;
}) => {
  const browse = async () => {
    const paths = await window.electron?.dialog.openFile({
      properties: ["openFile", "showHiddenFiles"],
      defaultPath,
      filters: [
        { name: "Certificate files", extensions },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (paths && paths[0]) onChange(paths[0]);
  };
  return (
    <div className="flex gap-2">
      <Input
        className="flex-1 min-w-0 font-mono text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`./certs/client.${extensions[0]}`}
        spellCheck={false}
        title={value}
        style={invalid ? { borderColor: "var(--icon-error)" } : undefined}
      />
      <button
        type="button"
        onClick={browse}
        className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-border-subtle text-sm text-text hover:bg-panel/50 transition-colors flex-shrink-0"
      >
        <FolderOpen className="w-3.5 h-3.5" />
        Browse
      </button>
    </div>
  );
};

const ClientCertificatesSettings = ({
  activeProject,
  matchesSearch,
}: {
  activeProject?: string;
  matchesSearch: (text: string) => boolean;
}) => {
  const [data, setData] = useState<CertList | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CertForm>(EMPTY_CERT_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof CertForm, string>>>({});
  const [check, setCheck] = useState<CertCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  // The form as it was when the dialog opened, to tell whether closing would lose edits.
  const [initialForm, setInitialForm] = useState<CertForm>(EMPTY_CERT_FORM);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const isDirty = (Object.keys(form) as (keyof CertForm)[]).some((k) => form[k] !== initialForm[k]);

  /** Backdrop, Esc, X and Cancel all go through here: ask first when there are unsaved edits. */
  const requestClose = () => {
    if (isDirty) setConfirmDiscard(true);
    else setOpen(false);
  };

  const reload = useCallback(async () => {
    const result = await window.electron?.clientCertificates?.list();
    setData(result ?? null);
  }, []);

  // Re-read when the project changes or the window regains focus (the file may be edited by hand).
  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload, activeProject]);

  // Bring the "Check certificate" result into view; it sits below the form.
  const checkRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (check) checkRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [check]);

  // Esc closes the dialog. Capture phase so editor shortcuts underneath don't swallow it.
  useEffect(() => {
    if (!open && pendingDelete === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pendingDelete !== null) {
        e.stopPropagation();
        setPendingDelete(null);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        // Esc on the discard prompt means "keep editing".
        if (confirmDiscard) setConfirmDiscard(false);
        else requestClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!matchesSearch("Client certificates mTLS mutual TLS certificate pfx p12 pem key CA certificates.yaml")) return null;

  const projectRoot = data && data.projectRoot ? data.projectRoot : null;
  const profiles = data && data.projectRoot ? data.profiles : [];
  const fileError = data && data.projectRoot ? data.error : undefined;

  const persist = async (next: ClientCertificateProfile[]) => {
    const result = await window.electron?.clientCertificates.save(next);
    if (result && !result.ok) {
      setSaveError(result.error);
      return false;
    }
    setSaveError(null);
    await reload();
    return true;
  };

  const update = (patch: Partial<CertForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setCheck(null);
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k as keyof CertForm];
      return next;
    });
  };

  const openForm = (index: number | null) => {
    setEditingIndex(index);
    const start = index === null ? EMPTY_CERT_FORM : toForm(profiles[index]);
    setForm(start);
    setInitialForm(start);
    setConfirmDiscard(false);
    setErrors({});
    setCheck(null);
    setSaveError(null);
    setShowPassphrase(false);
    setOpen(true);
  };

  const validate = () => {
    const next: typeof errors = {};
    const name = form.name.trim();
    if (!name) next.name = "Name is required";
    else if (RESERVED_CERT_NAMES.includes(name.toLowerCase())) next.name = `"${name}" is reserved for the client_certificate option`;
    else if (profiles.some((p, i) => i !== editingIndex && p.name === name)) next.name = "Another profile has this name";
    if (!form.hosts.split(",").some((h) => h.trim())) next.hosts = "Add at least one host";
    if (form.type === "pem" && !form.cert.trim()) next.cert = "Choose the certificate file";
    if (form.type === "pem" && !form.key.trim()) next.key = "Choose the private key file";
    if (form.type === "pfx" && !form.pfx.trim()) next.pfx = "Choose the PFX/P12 file";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const runCheck = async () => {
    if (!validate()) return;
    setChecking(true);
    try {
      const result = await window.electron?.clientCertificates.check(toProfile(form));
      setCheck(result ?? { ok: false, error: "Checking certificates needs the desktop app." });
    } catch (e: any) {
      setCheck({ ok: false, error: e?.message ?? String(e) });
    } finally {
      setChecking(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    const profile = toProfile(form);
    const next = editingIndex === null ? [...profiles, profile] : profiles.map((p, i) => (i === editingIndex ? profile : p));
    if (await persist(next)) setOpen(false);
  };

  const move = (index: number, by: -1 | 1) => {
    const next = [...profiles];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    persist(next);
  };

  const openFile = async () => {
    if (!data || !data.projectRoot) return;
    const response = await window.electron?.state.addPanelTab("main", {
      id: crypto.randomUUID(),
      type: "document",
      title: "certificates.yaml",
      source: data.file,
      directory: null,
    } as any);
    if (response?.tabId) {
      await window.electron?.state.activatePanelTab("main", response.tabId);
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    }
  };

  const visible = profiles
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => matchesSearch(`${p.name} ${p.hosts.join(" ")} client certificates mTLS`));

  return (
    <>
      <GroupLabel>
        <div className="flex items-center justify-between">
          <span>Client certificates (mTLS)</span>
          {projectRoot && !fileError && (
            <div className="flex items-center gap-1.5">
              {data && data.projectRoot && data.exists && (
                <button
                  onClick={openFile}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-border-subtle text-text hover:bg-panel/50 transition-colors"
                >
                  <FileText className="w-3 h-3" /> Open file
                </button>
              )}
              <button
                onClick={() => openForm(null)}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-border-subtle text-text hover:bg-panel/50 transition-colors"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
          )}
        </div>
      </GroupLabel>

      <Card>
        {!projectRoot ? (
          <div className="text-xs text-comment px-4 py-4 text-center">
            Client certificates are set per project. Open a project to manage them.
          </div>
        ) : fileError ? (
          <div className="flex items-start justify-between gap-3 px-4 py-3.5">
            <div className="flex items-start gap-1.5 text-xs" style={{ color: "var(--icon-error)" }}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              <span className="leading-relaxed">{fileError}</span>
            </div>
            <button
              onClick={openFile}
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-border-subtle text-text hover:bg-panel/50 transition-colors flex-shrink-0"
            >
              <FileText className="w-3 h-3" /> Fix in file
            </button>
          </div>
        ) : profiles.length === 0 ? (
          <div className="text-xs text-comment px-4 py-4 text-center">
            No client certificates in this project. Add one for APIs that require mutual TLS (mTLS).
          </div>
        ) : (
          visible.map(({ p, index }, idx, arr) => (
            <div
              key={p.name}
              className={`flex items-center justify-between gap-3 px-4 py-3.5 ${idx < arr.length - 1 ? "border-b border-border-subtle" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text break-words">{p.name}</div>
                <div className="text-xs text-comment mt-0.5 truncate" title={p.hosts.join(", ")}>
                  <span className="uppercase mr-1.5 opacity-80">{p.pfx ? "PFX" : "PEM"}</span>
                  {p.hosts.join(", ")}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {profiles.length > 1 && (
                  <>
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="p-1 hover:bg-panel/50 rounded text-comment hover:text-text transition-colors disabled:opacity-30 disabled:pointer-events-none"
                      title="Move up (checked earlier)"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === profiles.length - 1}
                      className="p-1 hover:bg-panel/50 rounded text-comment hover:text-text transition-colors disabled:opacity-30 disabled:pointer-events-none"
                      title="Move down (checked later)"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => openForm(index)}
                  className="p-1 hover:bg-panel/50 rounded text-comment hover:text-text transition-colors"
                  title="Edit certificate"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPendingDelete(index)}
                  className="p-1 hover:bg-panel/50 rounded transition-colors"
                  style={{ color: "var(--icon-error)" }}
                  title="Delete certificate"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </Card>
      {saveError && !open && (
        <div className="flex items-center gap-1 text-xs mt-2 px-1" style={{ color: "var(--icon-error)" }}>
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {saveError}
        </div>
      )}
      <p className="text-[11px] text-comment mt-2 px-1 leading-relaxed">
        Saved in <code className="font-mono">.voiden/certificates.yaml</code>, local to you and never committed. The first profile matching the host is used.
      </p>

      {pendingDelete !== null && profiles[pendingDelete] && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPendingDelete(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="client-cert-delete-title"
            className="bg-editor text-text border border-border rounded-lg shadow-2xl w-full max-w-sm p-5"
          >
            <div id="client-cert-delete-title" className="text-sm font-semibold text-text break-words">
              Delete "{profiles[pendingDelete].name}"?
            </div>
            <p className="text-xs text-comment mt-1.5 leading-relaxed">
              Requests to {profiles[pendingDelete].hosts.join(", ")} will no longer present this certificate. The certificate files on disk are not deleted.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setPendingDelete(null)} autoFocus className="px-3 py-1.5 bg-panel hover:bg-active rounded-md text-sm">
                Cancel
              </button>
              <button
                onClick={() => {
                  const index = pendingDelete;
                  setPendingDelete(null);
                  persist(profiles.filter((_, i) => i !== index));
                }}
                className="px-3 py-1.5 rounded-md text-sm hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "var(--icon-error)", color: "var(--ui-bg)" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) requestClose();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-cert-dialog-title"
            className="relative bg-editor text-text border border-border rounded-xl w-full max-w-xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
          >
            {confirmDiscard && (
              <div className="absolute inset-0 z-10 bg-black/40 flex items-center justify-center p-6">
                <div
                  role="alertdialog"
                  aria-labelledby="client-cert-discard-title"
                  className="bg-editor border border-border rounded-lg shadow-2xl w-full max-w-sm p-5"
                >
                  <div id="client-cert-discard-title" className="text-sm font-semibold text-text">
                    Discard unsaved changes?
                  </div>
                  <p className="text-xs text-comment mt-1.5 leading-relaxed">
                    Your edits to this certificate haven't been saved and will be lost.
                  </p>
                  <div className="flex justify-end gap-2 mt-4">
                    <button
                      onClick={() => setConfirmDiscard(false)}
                      autoFocus
                      className="px-3 py-1.5 bg-panel hover:bg-active rounded-md text-sm"
                    >
                      Keep editing
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDiscard(false);
                        setOpen(false);
                      }}
                      className="px-3 py-1.5 rounded-md text-sm hover:opacity-90 transition-opacity"
                      style={{ backgroundColor: "var(--icon-error)", color: "var(--ui-bg)" }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border-subtle">
              <div className="min-w-0">
                <div id="client-cert-dialog-title" className="text-lg font-semibold text-text leading-tight">
                  {editingIndex === null ? "Add client certificate" : "Edit client certificate"}
                </div>
              </div>
              <button
                onClick={requestClose}
                className="p-1 -mr-1 rounded text-comment hover:text-text hover:bg-panel/50 transition-colors"
                title="Close"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-5">
              <GroupLabel>General</GroupLabel>
              <Card>
                <FieldRow title="Name" error={errors.name}>
                  <Input
                    className="w-full"
                    value={form.name}
                    onChange={(e) => update({ name: e.target.value })}
                    placeholder="payments-mtls"
                    spellCheck={false}
                    autoFocus
                    style={errors.name ? { borderColor: "var(--icon-error)" } : undefined}
                  />
                </FieldRow>
                <FieldRow title="Hosts" error={errors.hosts} border={false}>
                  <Input
                    className="w-full"
                    value={form.hosts}
                    onChange={(e) => update({ hosts: e.target.value })}
                    placeholder="api.example.com, *.internal, localhost:8443"
                    spellCheck={false}
                    style={errors.hosts ? { borderColor: "var(--icon-error)" } : undefined}
                  />
                </FieldRow>
              </Card>

              <GroupLabel>Certificate</GroupLabel>
              <Card>
                <Row
                  title="Format"
                  description=""
                  control={
                    <Select value={form.type} onChange={(e) => update({ type: e.target.value as CertForm["type"] })}>
                      <option value="pem">PEM certificate + key</option>
                      <option value="pfx">PFX / P12 bundle</option>
                    </Select>
                  }
                />
                {form.type === "pem" ? (
                  <>
                    <FieldRow title="Certificate file" error={errors.cert}>
                      <FilePicker value={form.cert} onChange={(v) => update({ cert: v })} extensions={["pem", "crt", "cer"]} defaultPath={projectRoot ?? undefined} invalid={!!errors.cert} />
                    </FieldRow>
                    <FieldRow title="Private key file" error={errors.key}>
                      <FilePicker value={form.key} onChange={(v) => update({ key: v })} extensions={["key", "pem"]} defaultPath={projectRoot ?? undefined} invalid={!!errors.key} />
                    </FieldRow>
                  </>
                ) : (
                  <FieldRow title="PFX / P12 file" error={errors.pfx}>
                    <FilePicker value={form.pfx} onChange={(v) => update({ pfx: v })} extensions={["pfx", "p12"]} defaultPath={projectRoot ?? undefined} invalid={!!errors.pfx} />
                  </FieldRow>
                )}
                <FieldRow
                  title="Passphrase (optional)"
                  description={<>Type the password, or use a variable from your environment, e.g. <code className="font-mono">{"{{CLIENT_CERT_PASS}}"}</code>.</>}
                  border={false}
                >
                  <div className="flex gap-2">
                    <Input
                      className="flex-1 min-w-0 font-mono text-xs"
                      // A {{variable}} reference isn't secret, so it stays readable.
                      type={showPassphrase || isVariableReference(form.passphrase) ? "text" : "password"}
                      value={form.passphrase}
                      onChange={(e) => update({ passphrase: e.target.value })}
                      placeholder="••••••••"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {form.passphrase && !isVariableReference(form.passphrase) && (
                      <button
                        type="button"
                        onClick={() => setShowPassphrase((v) => !v)}
                        className="p-1.5 rounded-md border border-border-subtle text-comment hover:text-text hover:bg-panel/50 transition-colors flex-shrink-0"
                        title={showPassphrase ? "Hide passphrase" : "Show passphrase"}
                        aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
                      >
                        {showPassphrase ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </FieldRow>
              </Card>

              <GroupLabel>Server trust</GroupLabel>
              <Card>
                <FieldRow title="CA certificate (optional)" description="For servers signed by a private CA." border={false}>
                  <FilePicker value={form.ca} onChange={(v) => update({ ca: v })} extensions={["pem", "crt", "cer"]} defaultPath={projectRoot ?? undefined} />
                </FieldRow>
              </Card>

              {saveError && (
                <div className="flex items-start gap-1 text-xs mt-4" style={{ color: "var(--icon-error)" }}>
                  <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  {saveError}
                </div>
              )}

              {check && (
                <div ref={checkRef} className="mt-5">
                  <Card>
                    <div className="px-4 py-3.5">
                      <div
                        className="flex items-center gap-1.5 text-sm"
                        style={{ color: !check.ok || check.expired ? "var(--icon-error)" : "var(--icon-success)" }}
                      >
                        {check.ok && !check.expired ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                        {check.ok ? (check.expired ? "Certificate loads, but it has expired" : "Certificate loads") : "Certificate can't be used"}
                      </div>
                      {check.ok ? (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mt-2 text-xs">
                          {check.subject && (<><dt className="text-comment">Subject</dt><dd className="text-text truncate">{check.subject}</dd></>)}
                          {check.issuer && (<><dt className="text-comment">Issuer</dt><dd className="text-text truncate">{check.issuer}</dd></>)}
                          {check.validTo && (<><dt className="text-comment">Expires</dt><dd className="text-text">{new Date(check.validTo).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</dd></>)}
                        </dl>
                      ) : (
                        <div className="text-xs text-comment mt-1 leading-relaxed">{check.error}</div>
                      )}
                    </div>
                  </Card>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 px-6 py-3.5 border-t border-border-subtle">
              <button
                onClick={runCheck}
                disabled={checking}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border-subtle text-sm text-text hover:bg-panel/50 transition-colors disabled:opacity-50"
              >
                {checking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {checking ? "Checking…" : "Check certificate"}
              </button>
              <div className="flex gap-2">
                <button onClick={requestClose} className="px-3 py-1.5 bg-panel hover:bg-active rounded-md text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-3 py-1.5 rounded-md text-sm hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: "var(--icon-primary)", color: "var(--ui-bg)" }}
                >
                  {editingIndex === null ? "Add" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ── Terminal default shell (#598) ─────────────────────────────────────────────

const CUSTOM_SHELL = "__custom__";

/** Automatic, one of the detected shells, or a custom executable path. */
const DefaultShellControl = ({ value, onChange }: { value: string; onChange: (shell: string) => void }) => {
  const { data } = useTerminalShells();
  const shells = data?.shells ?? [];
  // Only decidable once the list has loaded; until then every value would look custom.
  const isCustom = !!data && !!value && !shells.some((s) => s.id === value);
  const [editingCustom, setEditingCustom] = useState(false);
  const customOpen = editingCustom || isCustom;
  const [typedPath, setTypedPath] = useState<string | null>(null);
  const customPath = typedPath ?? (isCustom ? value : "");
  const autoName = data && !data.configured ? shells.find((s) => s.id === data.defaultId)?.name : undefined;

  // Names only in the list: full paths (long on Windows) would stretch the select and squeeze the label.
  const selected = customOpen ? undefined : shells.find((s) => s.id === value);

  return (
    <div className="flex flex-col items-end gap-1.5 max-w-[260px]">
      <Select
        className="max-w-full"
        value={customOpen ? CUSTOM_SHELL : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM_SHELL) {
            setEditingCustom(true);
            return;
          }
          setEditingCustom(false);
          setTypedPath(null);
          onChange(e.target.value);
        }}
      >
        <option value="">Automatic{autoName ? ` (${autoName})` : ""}</option>
        {shells.map((s) => (
          <option key={s.id} value={s.id} title={s.path}>{s.name}</option>
        ))}
        <option value={CUSTOM_SHELL}>Custom path…</option>
      </Select>
      {selected && (
        <div className="max-w-full truncate font-mono text-[11px] text-comment" title={selected.path}>
          {selected.path}
        </div>
      )}
      {customOpen && (
        <Input
          value={customPath}
          placeholder={navigator.platform.startsWith("Win") ? "C:\\path\\to\\shell.exe" : "/path/to/shell"}
          onChange={(e) => setTypedPath(e.target.value)}
          onBlur={() => customPath.trim() && onChange(customPath.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="w-[260px] font-mono text-xs"
        />
      )}
    </div>
  );
};

// ── Plugin settings field renderer ────────────────────────────────────────────
// Reads current values from electron pluginSettings on mount, then writes
// individual keys back on each field change. No custom React from plugins.

const PluginSectionFields = ({ section }: { section: PluginSettingsSection }) => {
  const [values, setValues] = useState<Record<string, any>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.electron?.pluginSettings?.getAll(section.pluginId).then((stored: Record<string, any>) => {
      const defaults: Record<string, any> = {};
      for (const field of section.fields) {
        if ('defaultValue' in field && field.defaultValue !== undefined) {
          defaults[field.key] = field.defaultValue;
        }
      }
      setValues({ ...defaults, ...(stored ?? {}) });
      setLoaded(true);
    });
  }, [section.pluginId, section.id]);

  const handleChange = useCallback(async (key: string, value: any) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    await window.electron?.pluginSettings?.set(section.pluginId, key, value);
  }, [section.pluginId]);

  if (!loaded) return null;

  return (
    <div className="px-4 py-4 space-y-5">
      {section.fields.map((field) => {
        const val = values[field.key];
        return (
          <div key={field.key}>
            {field.type === 'toggle' ? (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-text">{field.label}</div>
                  {field.description && <div className="text-xs text-text-subtle mt-0.5">{field.description}</div>}
                </div>
                <Toggle
                  checked={val ?? false}
                  onChange={(v) => handleChange(field.key, v)}
                />
              </div>
            ) : (
              <div>
                <div className="text-sm text-text mb-1.5">{field.label}</div>
                {field.description && <div className="text-xs text-text-subtle mb-2">{field.description}</div>}
                {field.type === 'text' && (
                  <Input
                    value={val ?? ''}
                    placeholder={field.placeholder}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className="w-full max-w-sm"
                  />
                )}
                {field.type === 'number' && (
                  <Input
                    type="number"
                    value={val ?? ''}
                    placeholder={field.placeholder}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    onChange={(e) => handleChange(field.key, e.target.valueAsNumber)}
                    className="w-32"
                  />
                )}
                {field.type === 'select' && (
                  <Select
                    value={val ?? ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                  >
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Select>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const SettingsScreen = () => {
  const { data: projectsData } = useGetProjects();
  const activeProject = (projectsData as any)?.activeProject as string | undefined;

  const { settings, loading, save, saveImmediate, reset, onChange } = useSettings();
  const sidebarTabsPosition = useSidebarTabsPosition((s) => s.position);
  const setSidebarTabsPosition = useSidebarTabsPosition((s) => s.setPosition);
  const pluginSections = usePluginStore((state) => state.settingsPageSections);
  const [activeSection, setActiveSection] = useState("general");
  const [searchQuery, setSearchQuery] = useState("");

  const cursorTypes = useMemo(() => ["text", "default", "pointer"], []);
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const [fontFamilyDraft, setFontFamilyDraft] = useState("");
  const [projectDirectoryDraft, setProjectDirectoryDraft] = useState("");
  const [availableThemes, setAvailableThemes] = useState<{ value: string; label: string }[]>([]);
  const [showProxyForm, setShowProxyForm] = useState(false);
  const [editingProxy, setEditingProxy] = useState<ProxyConfig | null>(null);
  const [proxyForm, setProxyForm] = useState({
    name: "",
    host: "",
    port: 8080,
    auth: false,
    username: "",
    password: "",
    excludedDomains: "",
  });
  const [proxyFormErrors, setProxyFormErrors] = useState<{
    name?: string;
    host?: string;
    port?: string;
    username?: string;
    password?: string;
  }>({});
  const [isDownloadingFont, setIsDownloadingFont] = useState(false);
  const [fontDownloadError, setFontDownloadError] = useState<string | null>(null);
  const [isSyncingThemes, setIsSyncingThemes] = useState(false);
  const [themeSyncError, setThemeSyncError] = useState<string | null>(null);
  const [isInstallingCli, setIsInstallingCli] = useState(false);
  const [cliResult, setCliResult] = useState<CliResultMessage | null>(null);

  const commonFonts = useMemo(() => VALID_FONT_FAMILIES, []);

  // Refs for scrolling
  const generalRef = useRef<HTMLElement>(null);
  const appearanceRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const networkRef = useRef<HTMLElement>(null);
  const integrationsRef = useRef<HTMLElement>(null);
  const aiSkillsRef = useRef<HTMLElement>(null);
  const developerRef = useRef<HTMLElement>(null);
  const keyboardRef = useRef<HTMLElement>(null);
  const pluginsRef = useRef<HTMLElement>(null);
  const updatesRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [claudeSkillToggling, setClaudeSkillToggling] = useState(false);
  const [codexSkillToggling, setCodexSkillToggling] = useState(false);

  // Updates section state
  const [appVersion, setAppVersion] = useState<string>("");
  const [updaterLog, setUpdaterLog] = useState<string>("");
  const [isLoadingLog, setIsLoadingLog] = useState(false);
  const [isCopiedLog, setIsCopiedLog] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<{ status: string; percent?: number } | null>(null);

  const sections = useMemo(() => [
    { id: "general", label: "General", icon: <Settings className="w-4 h-4" />, ref: generalRef },
    { id: "appearance", label: "Appearance", icon: <Palette className="w-4 h-4" />, ref: appearanceRef },
    { id: "editor", label: "Editor", icon: <FileText className="w-4 h-4" />, ref: editorRef },
    { id: "network", label: "Network", icon: <Network className="w-4 h-4" />, ref: networkRef },
    { id: "integrations", label: "Integrations", icon: <Plug className="w-4 h-4" />, ref: integrationsRef },
    { id: "ai-skills", label: "AI Skills", icon: <Sparkles className="w-4 h-4" />, ref: aiSkillsRef },
    { id: "developer", label: "Developer", icon: <Code2 className="w-4 h-4" />, ref: developerRef },
    { id: "updates", label: "Updates", icon: <Download className="w-4 h-4" />, ref: updatesRef },
    { id: "keyboard", label: "Keyboard", icon: <Keyboard className="w-4 h-4" />, ref: keyboardRef },
    { id: "plugins", label: "Plugins", icon: <Plug className="w-4 h-4" />, ref: pluginsRef },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  // Keyboard shortcuts organized by category
  // Using Mac symbols - Kbd component will convert to Windows/Linux equivalents
  const keyboardShortcuts = useMemo(() => [
    {
      category: "File",
      shortcuts: [
        { keys: "⌘N", description: "New file" },
        { keys: "⌘S", description: "Save file" },
        { keys: "⌘O", description: "Open folder" },
        { keys: "⌘P", description: "Quick open file" },
        { keys: "⌘⇧P", description: "Command palette" },
      ]
    },
    {
      category: "Edit",
      shortcuts: [
        { keys: "⌘X", description: "Cut" },
        { keys: "⌘C", description: "Copy" },
        { keys: "⌘V", description: "Paste" },
        { keys: "⌘A", description: "Select all" },
      ]
    },
    {
      category: "Editor",
      shortcuts: [
        { keys: "⌘F", description: "Find in file" },
        { keys: "⌘G", description: "Find next" },
        { keys: "⌘⇧G", description: "Find previous" },
        { keys: "Esc", description: "Close find" },
      ]
    },
    {
      category: "Requests",
      shortcuts: [
        { keys: "⌘↵", description: "Send request" },
      ]
    },
    {
      category: "Developer",
      shortcuts: [
        { keys: "⌥⌘I", description: "Toggle developer tools (Mac)" },
        { keys: "F12", description: "Toggle developer tools (Windows/Linux)" },
      ]
    },
  ], []);

  // Load available themes on mount
  useEffect(() => {
    async function loadThemes() {
      const themes = await getAvailableThemes();
      setAvailableThemes(themes.map(theme => ({
        value: theme.id,
        label: theme.name,
      })));
    }
    loadThemes();
  }, []);

  // Listen for settings changes
  useEffect(() => {
    const unsubscribe = onChange(() => {
      // Settings updated from electron backend
    });
    return unsubscribe;
  }, [onChange]);

  // Load app version
  useEffect(() => {
    window.electron?.getVersion().then((v: string) => setAppVersion(v ?? ""));
  }, []);

  // Load updater log on mount; auto-refresh when an update is in progress
  const loadUpdaterLog = useCallback(async () => {
    setIsLoadingLog(true);
    try {
      const content = await window.electron?.readUpdaterLog();
      setUpdaterLog(content ?? "");
    } finally {
      setIsLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    loadUpdaterLog();
    const unsubscribe = window.electron?.onUpdateProgress((progress) => {
      setUpdateProgress(progress);
      loadUpdaterLog();
    });
    return () => unsubscribe?.();
  }, [loadUpdaterLog]);

  useEffect(() => {
    if (!loading && settings) {
      setFontFamilyDraft(settings.appearance.font_family ?? "");
      setProjectDirectoryDraft(settings.projects.default_directory ?? "");
    }
  }, [loading, settings?.appearance.font_family, settings?.projects.default_directory]);

  // Clear retention draft when saved value updates (save completed or external reset)
  useEffect(() => {
    setRetentionDraft(null);
  }, [settings?.history?.retention_days]);

  // Scroll listener to update active section based on scroll position
  useEffect(() => {
    if(loading || !settings) return;
    const container = contentRef.current;
    if (!container) return;

    const handleScroll = () => {
      const containerTop = container.getBoundingClientRect().top;
      let active = sections[0].id;
      for (const section of sections) {
        if (!section.ref.current) continue;
        const rect = section.ref.current.getBoundingClientRect();
        if (rect.top <= containerTop + 80) {
          active = section.id;
        }
      }
      setActiveSection(active);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [sections,loading,settings]);

  if (loading || !settings) {
    return <div className="h-full w-full flex items-center justify-center text-comment">Loading settings…</div>;
  }

  const scrollToSection = (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (section?.ref.current && contentRef.current) {
      const container = contentRef.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = section.ref.current.getBoundingClientRect();
      const offset = elementRect.top - containerRect.top + container.scrollTop - 24;
      container.scrollTo({ top: offset, behavior: 'smooth' });
      setActiveSection(sectionId);
    }
  };

  // Search filter logic
  const matchesSearch = (text: string) => {
    if (!searchQuery) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  const commitFontFamily = async () => {
    const trimmed = fontFamilyDraft.trim();
    if (trimmed && trimmed !== settings.appearance.font_family) {
      await save({ appearance: { font_family: trimmed } });
    } else {
      setFontFamilyDraft(settings.appearance.font_family);
    }
  };

  const commitProjectDirectory = async () => {
    const trimmed = projectDirectoryDraft.trim();
    if (trimmed && trimmed !== settings.projects.default_directory) {
      await saveImmediate({ projects: { default_directory: trimmed } });
      return;
    }
    setProjectDirectoryDraft(settings.projects.default_directory);
  };

  const handleBrowseProjectDirectory = async () => {
    const [selectedPath] = (await window.electron?.dialog.openFile({
      defaultPath: projectDirectoryDraft || settings.projects.default_directory,
      properties: ["openDirectory", "createDirectory"],
    })) ?? [];

    if (!selectedPath) return;
    setProjectDirectoryDraft(selectedPath);
    await saveImmediate({ projects: { default_directory: selectedPath } });
  };

  // Proxy validation
  const validateProxyForm = () => {
    const errors: typeof proxyFormErrors = {};

    if (!proxyForm.name.trim()) {
      errors.name = "Name is required";
    }

    if (!proxyForm.host.trim()) {
      errors.host = "Host is required";
    }

    if (!proxyForm.port || proxyForm.port < 1 || proxyForm.port > 65535) {
      errors.port = "Port must be between 1 and 65535";
    }

    if (proxyForm.auth) {
      if (!proxyForm.username.trim()) {
        errors.username = "Username is required when authentication is enabled";
      }
      if (!proxyForm.password.trim()) {
        errors.password = "Password is required when authentication is enabled";
      }
    }

    setProxyFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Proxy management functions
  const handleAddProxy = () => {
    setEditingProxy(null);
    setProxyForm({
      name: "",
      host: "",
      port: 8080,
      auth: false,
      username: "",
      password: "",
      excludedDomains: "",
    });
    setProxyFormErrors({});
    setShowProxyForm(true);
  };

  const handleEditProxy = (proxy: ProxyConfig) => {
    setEditingProxy(proxy);
    setProxyForm({
      name: proxy.name,
      host: proxy.host,
      port: proxy.port,
      auth: proxy.auth,
      username: proxy.username || "",
      password: proxy.password || "",
      excludedDomains: proxy.excludedDomains?.join(", ") || "",
    });
    setProxyFormErrors({});
    setShowProxyForm(true);
  };

  const handleSaveProxy = async () => {
    // Validate form first
    if (!validateProxyForm()) {
      return;
    }

    const excludedDomains = proxyForm.excludedDomains
      .split(',')
      .map(d => d.trim())
      .filter(d => d.length > 0);

    const proxy: ProxyConfig = {
      id: editingProxy?.id || `proxy-${Date.now()}`,
      name: proxyForm.name.trim(),
      host: proxyForm.host.trim(),
      port: proxyForm.port,
      auth: proxyForm.auth,
      username: proxyForm.auth && proxyForm.username.trim() ? proxyForm.username.trim() : undefined,
      password: proxyForm.auth && proxyForm.password.trim() ? proxyForm.password.trim() : undefined,
      excludedDomains: excludedDomains.length > 0 ? excludedDomains : undefined,
    };

    const proxies = editingProxy
      ? settings.proxy.proxies.map(p => p.id === editingProxy.id ? proxy : p)
      : [...settings.proxy.proxies, proxy];

    // Explicitly preserve all proxy fields
    await saveImmediate({
      proxy: {
        enabled: settings.proxy.enabled,
        proxies,
        activeProxyId: settings.proxy.activeProxyId
      }
    });

    setShowProxyForm(false);
    setEditingProxy(null);
  };

  const handleDeleteProxy = async (id: string) => {
    const proxies = settings.proxy.proxies.filter(p => p.id !== id);

    await saveImmediate({
      proxy: {
        enabled: settings.proxy.activeProxyId === id ? false : settings.proxy.enabled,
        proxies,
        activeProxyId: settings.proxy.activeProxyId === id ? undefined : settings.proxy.activeProxyId
      }
    });
  };

  const handleToggleProxy = async (id: string) => {
    const isCurrentlyActive = settings.proxy.activeProxyId === id;

    await saveImmediate({
      proxy: {
        enabled: !isCurrentlyActive,
        activeProxyId: isCurrentlyActive ? undefined : id,
      }
    });
  };

  const handleNerdFontToggle = async (enabled: boolean) => {
    if (enabled) {
      if (!settings.terminal.nerd_font_installed) {
        setIsDownloadingFont(true);
        setFontDownloadError(null);

        try {
          const result = await window.electron?.fonts.install();
          if (result?.success) {
            await saveImmediate({
              terminal: {
                use_nerd_font: true,
                nerd_font_installed: true,
              },
            });
          } else {
            setFontDownloadError(result?.error || "Failed to download font");
            await saveImmediate({
              terminal: {
                ...settings.terminal,
                use_nerd_font: false,
              },
            });
          }
        } catch (error) {
          setFontDownloadError(error instanceof Error ? error.message : "Unknown error");
          await saveImmediate({
            terminal: {
              ...settings.terminal,
              use_nerd_font: false,
            },
          });
        } finally {
          setIsDownloadingFont(false);
        }
      } else {
        await saveImmediate({
          terminal: {
            ...settings.terminal,
            use_nerd_font: true,
          },
        });
      }
    } else {
      await saveImmediate({
        terminal: {
          ...settings.terminal,
          use_nerd_font: false,
        },
      });
    }
  };

  const handleUninstallFont = async () => {
    try {
      const result = await window.electron?.fonts.uninstall();
      if (result?.success) {
        await saveImmediate({
          terminal: {
            use_nerd_font: false,
            nerd_font_installed: false,
          },
        });
      }
    } catch (error) {
    }
  };

  const handleSyncThemes = async () => {
    setIsSyncingThemes(true);
    setThemeSyncError(null);

    try {
      const result = await window.electron?.themes?.sync();
      if (result?.success) {
        // Reload the current theme to apply any updates
        const currentTheme = settings.appearance.theme || 'cursor-dark';
        await loadThemeById(currentTheme);

        // Refresh the available themes list
        const themes = await getAvailableThemes();
        setAvailableThemes(themes.map(theme => ({
          value: theme.id,
          label: theme.name,
        })));
      } else {
        setThemeSyncError(result?.error || "Failed to sync themes");
      }
    } catch (error) {
      setThemeSyncError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSyncingThemes(false);
    }
  };

  const handleCliInstall = async () => {
    setIsInstallingCli(true);
    setCliResult(null);

    try {
      const result = await window.electron?.cli?.install();
      if (result?.success) {
        setCliResult(result);
        await saveImmediate({
          cli: {
            installed: true,
          },
        });
      } else {
        setCliResult({ message: result?.message || "Installation failed", command: result?.command });
      }
    } catch (error) {
      setCliResult({ message: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setIsInstallingCli(false);
    }
  };

  const handleCliUninstall = async () => {
    setIsInstallingCli(true);
    setCliResult(null);

    try {
      const result = await window.electron?.cli?.uninstall();
      if (result?.success) {
        setCliResult(result);
        await saveImmediate({
          cli: {
            installed: false,
          },
        });
      } else {
        setCliResult({ message: result?.message || "Uninstallation failed", command: result?.command });
      }
    } catch (error) {
      setCliResult({ message: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setIsInstallingCli(false);
    }
  };

  const handleShowCliInstructions = async () => {
    await window.electron?.cli?.showInstructions();
  };

  const handleClaudeSkillToggle = async (enabled: boolean) => {
    setClaudeSkillToggling(true);
    try {
      await window.electron?.skills?.setClaude(enabled);
      await save({ skills: { ...settings.skills, claude: enabled } as any });
    } finally {
      setClaudeSkillToggling(false);
    }
  };

  const handleCodexSkillToggle = async (enabled: boolean) => {
    setCodexSkillToggling(true);
    try {
      await window.electron?.skills?.setCodex(enabled);
      await save({ skills: { ...settings.skills, codex: enabled } as any });
    } finally {
      setCodexSkillToggling(false);
    }
  };

  const handleEarlyAccessToggle = async (enable: boolean) => {
    const result = await window.electron?.userSettings.toggleEarlyAccess(enable);

    // If user cancelled, the settings won't change and onChange will not be triggered
    // The UI will automatically reflect the current state through the settings hook
    if (!result?.confirmed) {
      // Force a re-render to ensure toggle reflects current state
      // This handles the case where the toggle was clicked but user cancelled
      const currentSettings = await window.electron?.userSettings.get();
      if (currentSettings) {
        // The settings haven't changed, but we may need to refresh the UI
        // The onChange listener will handle this automatically
      }
    }
    // If confirmed, the app will restart, so no need to handle that case
  };

  return (
    <div className="h-full w-full bg-editor text-text flex">
      {/* Sidebar */}
      <div className="w-48 border-r border-border-subtle flex flex-col">
        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-comment" />
            <input
              type="text"
              placeholder="Search settings"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-transparent text-text border border-border-subtle rounded-md text-xs focus:outline-none focus:border-[var(--icon-primary)] placeholder:text-comment/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-0.5">
          {sections.filter((s) => s.id !== "plugins" || pluginSections.length > 0).map((section) => (
            <button
              key={section.id}
              onClick={() => scrollToSection(section.id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] transition-colors ${
                activeSection === section.id
                  ? "font-medium bg-panel/60"
                  : "hover:bg-panel/30 text-comment hover:text-text"
              }`}
              style={activeSection === section.id ? { color: 'var(--text)' } : {}}
            >
              <span className="w-4 h-4 flex items-center justify-center opacity-60">
                {section.icon}
              </span>
              {section.label}
            </button>
          ))}
        </div>

        <div className="p-2.5 border-t border-border-subtle">
          <button
            onClick={async () => {
              await reset();
              const resetSettings = await window.electron?.userSettings.get();
              if (resetSettings?.appearance?.theme) {
                await loadThemeById(resetSettings.appearance.theme);
              }
            }}
            className="w-full flex items-center justify-center gap-1.5 hover:bg-panel/50 px-2 py-1.5 rounded-md text-xs transition-colors text-comment hover:text-text"
          >
            <RefreshCw className="w-3 h-3" /> Reset All
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        <div className="max-w-[640px] mx-auto px-8 py-6">

          {/* ── General ──────────────────────────────────────────── */}
          <section ref={generalRef} data-section="general" className="mb-10">
            <h2 className="text-lg font-semibold text-text mb-4">General</h2>

            <Card>
              {matchesSearch("Projects Default project directory sample project workspace folder") && (
                <div className="px-4 py-3.5 border-b border-border-subtle">
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <div>
                      <div className="text-sm text-text">Default project directory</div>
                      <div className="text-xs text-comment mt-0.5">Where Voiden creates and bootstraps new projects.</div>
                    </div>
                    <button
                      onClick={handleBrowseProjectDirectory}
                      className="shrink-0 px-3 py-1 rounded-md border border-border-subtle text-sm text-text hover:bg-panel/50 transition-colors"
                    >
                      Browse
                    </button>
                  </div>
                  <Input
                    value={projectDirectoryDraft}
                    onChange={(event) => setProjectDirectoryDraft(event.target.value)}
                    onBlur={commitProjectDirectory}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void commitProjectDirectory();
                      }
                    }}
                    placeholder="Choose a folder"
                    className="w-full"
                  />
                </div>
              )}

              {matchesSearch("On startup restore reopen windows session launch") && (
                <Row
                  title="On startup"
                  description="Windows to reopen when you launch Voiden. Windows that aren't reopened are forgotten. Restarts for an update always reopen your open windows."
                  control={
                    <Select
                      value={settings.startup?.restore_windows ?? "all"}
                      onChange={(e) => {
                        save({ startup: { restore_windows: e.target.value as "all" | "last" | "none" } });
                      }}
                    >
                      <option value="all">Reopen all windows (default)</option>
                      <option value="last">Reopen the last window</option>
                      <option value="none">Start with a new window</option>
                    </Select>
                  }
                />
              )}

              {matchesSearch("Early Access early access new features updates beta") && (
                <Row
                  title="Early Access"
                  description="Get early access to new features and updates. May be less stable."
                  control={
                    <Toggle
                      checked={settings.updates.channel === "early-access"}
                      onChange={(v) => handleEarlyAccessToggle(v)}
                    />
                  }
                />
              )}

              {matchesSearch("History Enable history record requests") && (
                <Row
                  title="Request History"
                  description="Record requests and responses in .voiden/history/."
                  border={!(settings?.history?.enabled ?? false)}
                  control={
                    <Toggle
                      checked={settings?.history?.enabled ?? false}
                      onChange={(v) => save({ history: { enabled: v, retention_days: settings?.history?.retention_days ?? 2 } })}
                    />
                  }
                />
              )}
              {(settings?.history?.enabled ?? false) && matchesSearch("Retention Period days history keep") && (
                <Row
                  title="History retention"
                  description="Days to keep history entries before automatic pruning."
                  border={false}
                  control={(() => {
                    const savedDays = settings?.history?.retention_days ?? 2;
                    const display = retentionDraft !== null ? retentionDraft : String(savedDays);
                    const num = Number(display);
                    const isInvalid = display !== "" && (isNaN(num) || !Number.isInteger(num) || num < 1 || num > 90);
                    const step = (dir: 1 | -1) => {
                      const base = retentionDraft !== null && retentionDraft !== "" && !isNaN(Number(retentionDraft))
                        ? Math.round(Number(retentionDraft))
                        : savedDays;
                      const next = Math.min(90, Math.max(1, base + dir));
                      setRetentionDraft(null);
                      save({ history: { enabled: true, retention_days: next } });
                    };
                    return (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-2">
                          <div className="flex items-stretch rounded border border-border-subtle overflow-hidden">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={display}
                              onChange={(e) => setRetentionDraft(e.target.value.replace(/[^0-9]/g, ''))}
                              onBlur={() => {
                                if (retentionDraft === null || retentionDraft === "") {
                                  setRetentionDraft(null);
                                  return;
                                }
                                const n = Number(retentionDraft);
                                const clamped = Math.min(90, Math.max(1, isNaN(n) ? savedDays : Math.round(n)));
                                setRetentionDraft(String(clamped));
                                save({ history: { enabled: true, retention_days: clamped } });
                              }}
                              className="w-12 text-center bg-editor text-text text-sm px-1.5 py-1 focus:outline-none"
                            />
                            <div className="flex flex-col border-l border-border-subtle">
                              <button
                                type="button"
                                onClick={() => step(1)}
                                className="flex-1 flex items-center justify-center px-1 bg-panel/50 hover:bg-panel transition-colors border-b border-border-subtle"
                              >
                                <ChevronUp className="w-3 h-3 text-comment" />
                              </button>
                              <button
                                type="button"
                                onClick={() => step(-1)}
                                className="flex-1 flex items-center justify-center px-1 bg-panel/50 hover:bg-panel transition-colors"
                              >
                                <ChevronDown className="w-3 h-3 text-comment" />
                              </button>
                            </div>
                          </div>
                          <span className="text-xs text-comment">days</span>
                        </div>
                        {isInvalid && (
                          <span className="text-xs" style={{ color: 'var(--icon-error)' }}>
                            {num < 1 || display === "0" ? "Min is 1 day" : "Max is 90 days"}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                />
              )}
            </Card>
          </section>

          {/* ── Appearance ───────────────────────────────────────── */}
          <section ref={appearanceRef} data-section="appearance" className="mb-10">
            <h2 className="text-lg font-semibold text-text mb-4">Appearance</h2>

            <Card>
              {matchesSearch("Theme Choose a color theme for the editor") && (
                <Row
                  title="Theme"
                  description="Color theme for the editor."
                  control={
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={settings.appearance.theme || "cursor-dark"}
                        onChange={async (e) => {
                          const newTheme = e.target.value;
                          await loadThemeById(newTheme);
                          await save({ appearance: { theme: newTheme } });
                        }}
                      >
                        {availableThemes.map((theme) => (
                          <option key={theme.value} value={theme.value}>
                            {theme.label}
                          </option>
                        ))}
                      </Select>
                      <button
                        onClick={handleSyncThemes}
                        disabled={isSyncingThemes}
                        className="p-1.5 rounded-md hover:bg-panel/50 border border-border-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Sync themes"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncingThemes ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  }
                />
              )}
              {themeSyncError && (
                <div className="mx-4 mb-3 px-3 py-2 rounded text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--icon-error) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--icon-error) 30%, transparent)', borderWidth: '1px' }}>
                  <span style={{ color: 'var(--icon-error)' }}>Error syncing themes: {themeSyncError}</span>
                </div>
              )}
              {matchesSearch("Editor Font size Code editor font size in pixels") && (
                <Row
                  title="Editor font size"
                  description="Code editor font size in pixels."
                  control={
                    <Select
                      value={settings.appearance.font_size}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (value >= FONT_SIZE_MIN && value <= FONT_SIZE_MAX) {
                          save({ appearance: { font_size: value } });
                        }
                      }}
                    >
                      {Array.from({ length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1 }, (_, i) => FONT_SIZE_MIN + i).map((size) => (
                        <option key={size} value={size}>
                          {size}px
                        </option>
                      ))}
                    </Select>
                  }
                />
              )}
              {matchesSearch("UI Font size Interface font size for panels sidebar and labels") && (
                <Row
                  title="UI font size"
                  description="Interface font size for panels, sidebar, and labels."
                  control={
                    <Select
                      value={settings.appearance.ui_font_size ?? 13}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (value >= UI_FONT_SIZE_MIN && value <= UI_FONT_SIZE_MAX) {
                          save({ appearance: { ui_font_size: value } });
                        }
                      }}
                    >
                      {Array.from({ length: UI_FONT_SIZE_MAX - UI_FONT_SIZE_MIN + 1 }, (_, i) => UI_FONT_SIZE_MIN + i).map((size) => (
                        <option key={size} value={size}>
                          {size}px
                        </option>
                      ))}
                    </Select>
                  }
                />
              )}
              {matchesSearch("Left panel tabs position side top activity bar vertical sidebar") && (
                <Row
                  title="Left panel tabs"
                  description="In a row above the panel, or in a vertical bar beside it, like VS Code's Activity Bar."
                  control={
                    <Select value={sidebarTabsPosition} onChange={(e) => setSidebarTabsPosition(e.target.value as SidebarTabsPosition)}>
                      <option value="top">Top</option>
                      <option value="side">Side</option>
                    </Select>
                  }
                />
              )}
              {matchesSearch("Font family Select a monospace font for the editor") && (
                <Row
                  title="Font family"
                  description="Monospace font for the editor."
                  control={
                    <Select
                      value={fontFamilyDraft}
                      onChange={(e) => {
                        const selectedFont = e.target.value;
                        setFontFamilyDraft(selectedFont);
                        if (selectedFont === "" || VALID_FONT_FAMILIES.includes(selectedFont)) {
                          save({ appearance: { font_family: selectedFont } });
                        }
                      }}
                    >
                      {commonFonts.map((font) => (
                        <option key={font} value={font} style={{ fontFamily: `"${font}", monospace` }}>
                          {font}
                        </option>
                      ))}
                    </Select>
                  }
                />
              )}
              {matchesSearch("Word Wrap") && (
                <Row
                  title="Word wrap"
                  description="Wrap long lines in the editor."
                  control={
                    <Toggle
                      checked={settings.appearance.code_wrap}
                      onChange={(v) => save({ appearance: { code_wrap: v } })}
                    />
                  }
                />
              )}
              {matchesSearch("Content Width Maximum width for document content area") && (
                <Row
                  title="Content width"
                  description="Maximum width for document content area."
                  border={false}
                  control={
                    <Select
                      value={settings.appearance.content_width ?? 860}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (value === 0 || (value >= CONTENT_WIDTH_MIN && value <= CONTENT_WIDTH_MAX)) {
                          save({ appearance: { content_width: value } });
                        }
                      }}
                    >
                      {[600, 700, 760, 820, 860, 920, 1000, 1100, 1200, 1400].map((size) => (
                        <option key={size} value={size}>
                          {size}px{size === 860 ? " (default)" : ""}
                        </option>
                      ))}
                      <option value={0}>No limit</option>
                    </Select>
                  }
                />
              )}
              {matchesSearch("Separator alignment Request separator position left center right") && (
                <Row
                  title="Separator alignment"
                  description="Position of the request separator label."
                  border={false}
                  control={
                    <Select
                      value={settings.appearance.separator_alignment ?? "center"}
                      onChange={(e) => {
                        save({ appearance: { separator_alignment: e.target.value as "left" | "center" | "right" } });
                      }}
                    >
                      <option value="left">Left</option>
                      <option value="center">Center (default)</option>
                      <option value="right">Right</option>
                    </Select>
                  }
                />
              )}
            </Card>
          </section>

          {/* ── Editor ───────────────────────────────────────────── */}
          <section ref={editorRef} data-section="editor" className="mb-10">
            <h2 className="text-lg font-semibold text-text mb-4">Editor</h2>

            <Card>
              {matchesSearch("Auto save Automatically persist changes while typing") && (
                <Row
                  title="Auto save"
                  description="Automatically persist changes while typing."
                  border={!!settings.editor.auto_save}
                  control={
                    <Toggle
                      checked={settings.editor.auto_save}
                      onChange={(v) => save({ editor: { auto_save: v } })}
                    />
                  }
                />
              )}
              {!!settings.editor.auto_save && matchesSearch("Auto save delay How long to wait after typing before saving changes") && (
                <Row
                  title="Auto save delay"
                  description="How long to wait after typing before saving."
                  border={false}
                  control={
                    <Select
                      value={settings.editor.auto_save_delay}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        save({ editor: { auto_save_delay: value } });
                      }}
                    >
                      <option value={0}>Instant (every change)</option>
                      <option value={5}>5 seconds</option>
                      <option value={10}>10 seconds</option>
                      <option value={30}>30 seconds</option>
                      <option value={60}>1 minute</option>
                      <option value={300}>5 minutes</option>
                      <option value={600}>10 minutes</option>
                      <option value={1800}>30 minutes</option>
                    </Select>
                  }
                />
              )}
              {matchesSearch("Code block max lines Maximum height code block expand collapse") && (
                <Row
                  title="Code block max lines"
                  description="Maximum number of lines a code block expands to before scrolling. Set to Unlimited to always expand fully."
                  control={
                    <Select
                      value={settings.editor.code_block_max_lines ?? 50}
                      onChange={(e) => {
                        save({ editor: { code_block_max_lines: Number(e.target.value) } });
                      }}
                    >
                      <option value={25}>25 lines</option>
                      <option value={50}>50 lines (default)</option>
                      <option value={100}>100 lines</option>
                      <option value={200}>200 lines</option>
                      <option value={500}>500 lines</option>
                      <option value={0}>Unlimited</option>
                    </Select>
                  }
                />
              )}
              {matchesSearch("Block Overview outline panel blocks requests void file") && (
                <Row
                  title="Block Overview"
                  description="Show a collapsible outline panel beside the editor listing all blocks in the current .void file, grouped by request section."
                  control={
                    <Toggle
                      checked={settings.editor?.block_overview ?? false}
                      onChange={(v) => save({ editor: { block_overview: v } })}
                    />
                  }
                />
              )}
              {matchesSearch("Pending Tabs preview tab single click file explorer italic") && (
                <Row
                  title="Pending Tabs"
                  description="Single-clicking a file opens it as a pending tab (shown in italics), replaced when you open another file. Double-click to make it permanent."
                  border={false}
                  control={
                    <Toggle
                      checked={settings.editor?.pending_tabs ?? false}
                      onChange={(v) => save({ editor: { pending_tabs: v } })}
                    />
                  }
                />
              )}
            </Card>
          </section>

          {/* ── Network ──────────────────────────────────────────── */}
          <section ref={networkRef} data-section="network" className="mb-10">
            <h2 className="text-lg font-semibold text-text mb-4">Network</h2>

            <Card>
              {matchesSearch("Disable TLS Verification TLS verification development local testing") && (
                <Row
                  title="Disable TLS verification"
                  description="Skip certificate validation for development and local testing."
                  control={
                    <Toggle
                      checked={settings.requests.disable_tls_verification}
                      onChange={(v) => save({ requests: { disable_tls_verification: v } })}
                    />
                  }
                />
              )}
              {matchesSearch("Follow Redirects redirect 302 301 automatic") && (
                <Row
                  title="Follow redirects"
                  description="Automatically follow HTTP redirects (3xx). Disable to inspect redirect responses directly."
                  control={
                    <Toggle
                      checked={settings.requests.follow_redirects}
                      onChange={(v) => save({ requests: { follow_redirects: v } })}
                    />
                  }
                />
              )}
              {matchesSearch("Request Timeout timeout limit seconds minutes") && (
                <Row
                  title="Request timeout"
                  description="Maximum time to wait for a response."
                  border={false}
                  control={
                    <Select
                      value={settings.requests.timeout}
                      onChange={(e) => {
                        save({ requests: { timeout: Number(e.target.value) } });
                      }}
                    >
                      <option value={30}>30 seconds</option>
                      <option value={60}>1 minute</option>
                      <option value={120}>2 minutes</option>
                      <option value={300}>5 minutes</option>
                      <option value={600}>10 minutes</option>
                      <option value={0}>No limit</option>
                    </Select>
                  }
                />
              )}
            </Card>

            {/* Proxy sub-section */}
            {matchesSearch("Proxy proxy configuration network") && (
              <>
                <GroupLabel>
                  <div className="flex items-center justify-between">
                    <span>Proxy</span>
                    <button
                      onClick={handleAddProxy}
                      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-border-subtle text-text hover:bg-panel/50 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                </GroupLabel>

                <Card>
                  {settings.proxy.proxies.length === 0 ? (
                    <div className="text-xs text-comment px-4 py-4 text-center">
                      No proxies configured.
                    </div>
                  ) : (
                    settings.proxy.proxies
                      .filter((proxy) => matchesSearch(`${proxy.name} ${proxy.host} proxy`))
                      .map((proxy, idx, arr) => {
                      const isActive = settings.proxy.activeProxyId === proxy.id;
                      return (
                        <div
                          key={proxy.id}
                          className={`flex items-center justify-between gap-3 px-4 py-3.5 ${idx < arr.length - 1 ? 'border-b border-border-subtle' : ''}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-text flex items-center gap-2">
                              {proxy.name}
                              {isActive && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--icon-primary)', color: 'var(--ui-bg)' }}>
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-comment mt-0.5">
                              {proxy.host}:{proxy.port}
                              {proxy.auth && <span className="ml-2 opacity-70">auth</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Toggle
                              checked={isActive}
                              onChange={() => handleToggleProxy(proxy.id)}
                            />
                            <button
                              onClick={() => handleEditProxy(proxy)}
                              className="p-1 hover:bg-panel/50 rounded text-comment hover:text-text transition-colors"
                              title="Edit proxy"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteProxy(proxy.id)}
                              className="p-1 hover:bg-panel/50 rounded transition-colors"
                              style={{ color: 'var(--icon-error)' }}
                              title="Delete proxy"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </Card>
              </>
            )}

            <ClientCertificatesSettings activeProject={activeProject} matchesSearch={matchesSearch} />
          </section>

          {/* ── Integrations ─────────────────────────────────────── */}
          <section ref={integrationsRef} data-section="integrations" className="mb-10">
            <h2 className="text-lg font-semibold text-text mb-4">Integrations</h2>

            {/* Terminal / Nerd Font */}
            <Card>
              {matchesSearch("Default shell terminal bash zsh fish powershell pwsh cmd wsl") && (
                <Row
                  title="Default shell"
                  description="Shell new terminals start in. Pick another for a single terminal from the ▾ next to the terminal's + button."
                  control={
                    <DefaultShellControl
                      value={settings.terminal.default_shell ?? ""}
                      onChange={(shell) => save({ terminal: { ...settings.terminal, default_shell: shell } })}
                    />
                  }
                />
              )}
              {matchesSearch("Use Nerd Font terminal font JetBrains Mono icons") && (
                <div className="px-4 py-3.5 border-b border-border-subtle">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="text-sm text-text">Terminal Nerd Font</div>
                      <div className="text-xs text-comment mt-0.5 leading-relaxed">
                        Use JetBrains Mono Nerd Font for icon support in terminal.
                        {settings.terminal.nerd_font_installed && !isDownloadingFont && (
                          <span className="inline-flex items-center gap-1 ml-1" style={{ color: 'var(--icon-success)' }}>
                            <Check className="w-3 h-3" /> Installed
                          </span>
                        )}
                      </div>
                    </div>
                    <Toggle
                      checked={settings.terminal.use_nerd_font}
                      onChange={handleNerdFontToggle}
                      disabled={isDownloadingFont}
                    />
                  </div>

                  {isDownloadingFont && (
                    <div className="mt-2.5 p-2.5 rounded text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--icon-primary) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--icon-primary) 30%, transparent)', borderWidth: '1px' }}>
                      <div className="flex items-center gap-2">
                        <div className="animate-spin h-3.5 w-3.5 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--icon-primary)', borderTopColor: 'transparent' }}></div>
                        <span style={{ color: 'var(--icon-primary)' }}>Downloading font (~112MB)…</span>
                      </div>
                    </div>
                  )}

                  {fontDownloadError && (
                    <div className="mt-2.5 p-2.5 rounded text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--icon-error) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--icon-error) 30%, transparent)', borderWidth: '1px' }}>
                      <span style={{ color: 'var(--icon-error)' }}>Error: {fontDownloadError}</span>
                    </div>
                  )}

                  {settings.terminal.nerd_font_installed && !isDownloadingFont && (
                    <div className="mt-2 pt-2 border-t border-border-subtle">
                      <button
                        onClick={handleUninstallFont}
                        className="text-xs transition"
                        style={{ color: 'var(--icon-error)' }}
                      >
                        Uninstall Font
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* CLI */}
              {matchesSearch("CLI command line terminal voiden install") && (
                <div className="px-4 py-3.5 border-b border-border-subtle">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="text-sm text-text">Command Line Interface</div>
                      <div className="text-xs text-comment mt-0.5 leading-relaxed">
                        Install the <code className="px-1 py-0.5 bg-panel/50 rounded text-[11px]">voiden</code> command.
                        {settings.cli?.installed && (
                          <span className="inline-flex items-center gap-1 ml-1" style={{ color: 'var(--icon-success)' }}>
                            <Check className="w-3 h-3" /> Installed
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!settings.cli?.installed ? (
                        <>
                          <button
                            onClick={handleCliInstall}
                            disabled={isInstallingCli}
                            className="px-3 py-1 rounded-md text-xs border border-border-subtle text-text hover:bg-panel/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isInstallingCli ? "Installing…" : "Install"}
                          </button>
                          <button
                            onClick={handleShowCliInstructions}
                            className="px-3 py-1 rounded-md text-xs border border-border-subtle text-comment hover:text-text hover:bg-panel/50 transition-colors"
                          >
                            Instructions
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={handleCliUninstall}
                          disabled={isInstallingCli}
                          className="px-3 py-1 rounded-md text-xs border border-border-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ color: 'var(--icon-error)' }}
                        >
                          {isInstallingCli ? "Uninstalling…" : "Uninstall"}
                        </button>
                      )}
                    </div>
                  </div>

{cliResult && <CliCommandMessage message={cliResult.message} command={cliResult.command} />}
                </div>
              )}
            </Card>

          </section>

          {/* ── AI Skills ────────────────────────────────────────── */}
          <section ref={aiSkillsRef} data-section="ai-skills" className="mb-10">
            <h2 className="text-lg font-semibold text-text mb-4">AI Skills</h2>

            {matchesSearch("AI skills claude codex voiden skill enable") && (
              <Card>
                <Row
                  title="Claude Code"
                  description="Install skill so Claude agents understand .void files."
                  control={
                    <Toggle
                      checked={settings.skills?.claude ?? false}
                      onChange={handleClaudeSkillToggle}
                      disabled={claudeSkillToggling}
                    />
                  }
                />
                <Row
                  title="Codex"
                  description="Install skill so Codex agents understand .void files."
                  border={false}
                  control={
                    <Toggle
                      checked={settings.skills?.codex ?? false}
                      onChange={handleCodexSkillToggle}
                      disabled={codexSkillToggling}
                    />
                  }
                />
              </Card>
            )}
          </section>

          {/* ── Developer ────────────────────────────────────────── */}
          <section ref={developerRef} data-section="developer" className="mb-10">
            <h2 className="text-lg font-semibold text-text mb-4">Developer</h2>

            <Card>
              {matchesSearch("System Log developer process IPC git state") && (
                <Row
                  title="System Log"
                  description="Show the System Log tab to inspect IPC calls, git operations, and state changes."
                  border={false}
                  control={
                    <Toggle
                      checked={settings.developer?.system_log ?? false}
                      onChange={(v) => save({ developer: { system_log: v } })}
                    />
                  }
                />
              )}
            </Card>
          </section>

          {/* ── Updates ──────────────────────────────────────────── */}
          <section ref={updatesRef} data-section="updates" className="mb-10">
            <h2 className="text-lg font-semibold text-text mb-4">Updates</h2>

            <Card>
              <div className="px-4 py-3.5 border-b border-border-subtle flex items-center justify-between">
                <div>
                  <div className="text-sm text-text">Current version</div>
                  <div className="text-xs text-comment mt-0.5">
                    {appVersion ? `v${appVersion}` : "—"}
                  </div>
                </div>
                {updateProgress && updateProgress.status !== "idle" && updateProgress.status !== "checking" && (
                  <div className="text-xs text-comment">
                    {updateProgress.status === "downloading" && typeof updateProgress.percent === "number"
                      ? `Downloading… ${updateProgress.percent}%`
                      : updateProgress.status === "installing"
                      ? "Installing…"
                      : updateProgress.status === "ready"
                      ? "Ready to install"
                      : null}
                  </div>
                )}
              </div>

              {/* Updater log viewer */}
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-comment">Updater log</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={loadUpdaterLog}
                      disabled={isLoadingLog}
                      title="Refresh log"
                      className="p-1 rounded hover:bg-panel/50 text-comment hover:text-text transition-colors disabled:opacity-40"
                    >
                      <RotateCcw className={`w-3 h-3 ${isLoadingLog ? "animate-spin" : ""}`} />
                    </button>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(updaterLog);
                        setIsCopiedLog(true);
                        setTimeout(() => setIsCopiedLog(false), 1500);
                      }}
                      disabled={!updaterLog}
                      title="Copy log"
                      className="p-1 rounded hover:bg-panel/50 text-comment hover:text-text transition-colors disabled:opacity-40"
                    >
                      {isCopiedLog ? <Check className="w-3 h-3" style={{ color: "var(--icon-primary)" }} /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
                <pre
                  className="text-[11px] leading-relaxed text-comment bg-surface rounded-md p-3 overflow-auto max-h-72 whitespace-pre-wrap break-all font-mono"
                  style={{ minHeight: "4rem" }}
                >
                  {updaterLog || "No log entries yet. Log is cleared at the start of each update check."}
                </pre>
              </div>
            </Card>
          </section>

          {/* ── Plugins ──────────────────────────────────────────── */}
          {pluginSections.length > 0 && (
            <section ref={pluginsRef} data-section="plugins" className="mb-10">
              <h2 className="text-lg font-semibold text-text mb-4">Plugins</h2>
              <div className="space-y-4">
                {pluginSections.map((section) => (
                  <Card key={section.id}>
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
                      {section.icon && <section.icon className="w-4 h-4 opacity-60" />}
                      <span className="text-sm font-medium text-text">{section.title}</span>
                    </div>
                    <PluginSectionFields section={section} />
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* ── Keyboard ─────────────────────────────────────────── */}
          <section ref={keyboardRef} data-section="keyboard" className="mb-10">
            <h2 className="text-lg font-semibold text-text mb-4">Keyboard Shortcuts</h2>

            {keyboardShortcuts.map((group) => {
              const filteredShortcuts = group.shortcuts.filter(
                (shortcut) => matchesSearch(`${shortcut.description} ${shortcut.keys} ${group.category}`)
              );

              if (filteredShortcuts.length === 0) return null;

              return (
                <div key={group.category} className="mb-4">
                  <GroupLabel>{group.category}</GroupLabel>
                  <Card>
                    {filteredShortcuts.map((shortcut, index) => (
                      <div key={index} className={`flex items-center justify-between px-4 py-2.5 ${index < filteredShortcuts.length - 1 ? 'border-b border-border-subtle' : ''}`}>
                        <span className="text-sm text-text">{shortcut.description}</span>
                        <Kbd keys={shortcut.keys} size="md" />
                      </div>
                    ))}
                  </Card>
                </div>
              );
            })}
          </section>

          <div className="pb-6 text-center">
            <span className="text-[11px] text-comment/50">Changes save automatically</span>
          </div>
        </div>
      </div>

      {/* Proxy Form Modal */}
      {showProxyForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-editor border border-border rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-base font-semibold">
              {editingProxy ? 'Edit Proxy' : 'Add Proxy'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-comment mb-1">Name</label>
                <Input
                  value={proxyForm.name}
                  onChange={(e) => {
                    setProxyForm({ ...proxyForm, name: e.target.value });
                    if (proxyFormErrors.name) setProxyFormErrors({ ...proxyFormErrors, name: undefined });
                  }}
                  placeholder="My Proxy"
                  style={proxyFormErrors.name ? { borderColor: 'var(--icon-error)' } : {}}
                />
                {proxyFormErrors.name && (
                  <p className="text-xs mt-1" style={{ color: 'var(--icon-error)' }}>{proxyFormErrors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-comment mb-1">Host</label>
                <Input
                  value={proxyForm.host}
                  onChange={(e) => {
                    setProxyForm({ ...proxyForm, host: e.target.value });
                    if (proxyFormErrors.host) setProxyFormErrors({ ...proxyFormErrors, host: undefined });
                  }}
                  placeholder="proxy.example.com"
                  style={proxyFormErrors.host ? { borderColor: 'var(--icon-error)' } : {}}
                />
                {proxyFormErrors.host && (
                  <p className="text-xs mt-1" style={{ color: 'var(--icon-error)' }}>{proxyFormErrors.host}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-comment mb-1">Port</label>
                <Input
                  type="number"
                  value={proxyForm.port}
                  onChange={(e) => {
                    setProxyForm({ ...proxyForm, port: parseInt(e.target.value) || 0 });
                    if (proxyFormErrors.port) setProxyFormErrors({ ...proxyFormErrors, port: undefined });
                  }}
                  min={1}
                  max={65535}
                  style={proxyFormErrors.port ? { borderColor: 'var(--icon-error)' } : {}}
                />
                {proxyFormErrors.port && (
                  <p className="text-xs mt-1" style={{ color: 'var(--icon-error)' }}>{proxyFormErrors.port}</p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs text-comment">Authentication</label>
                <Toggle
                  checked={proxyForm.auth}
                  onChange={(v) => setProxyForm({ ...proxyForm, auth: v })}
                />
              </div>

              {proxyForm.auth && (
                <>
                  <div>
                    <label className="block text-xs text-comment mb-1">Username</label>
                    <Input
                      value={proxyForm.username}
                      onChange={(e) => {
                        setProxyForm({ ...proxyForm, username: e.target.value });
                        if (proxyFormErrors.username) setProxyFormErrors({ ...proxyFormErrors, username: undefined });
                      }}
                      style={proxyFormErrors.username ? { borderColor: 'var(--icon-error)' } : {}}
                    />
                    {proxyFormErrors.username && (
                      <p className="text-xs mt-1" style={{ color: 'var(--icon-error)' }}>{proxyFormErrors.username}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs text-comment mb-1">Password</label>
                    <Input
                      type="password"
                      value={proxyForm.password}
                      onChange={(e) => {
                        setProxyForm({ ...proxyForm, password: e.target.value });
                        if (proxyFormErrors.password) setProxyFormErrors({ ...proxyFormErrors, password: undefined });
                      }}
                      style={proxyFormErrors.password ? { borderColor: 'var(--icon-error)' } : {}}
                    />
                    {proxyFormErrors.password && (
                      <p className="text-xs mt-1" style={{ color: 'var(--icon-error)' }}>{proxyFormErrors.password}</p>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs text-comment mb-1">
                  Excluded Domains (optional)
                </label>
                <Input
                  value={proxyForm.excludedDomains}
                  onChange={(e) => setProxyForm({ ...proxyForm, excludedDomains: e.target.value })}
                  placeholder="localhost, 127.0.0.1, *.internal"
                />
                <p className="text-[11px] text-comment mt-1">
                  Comma-separated list of domains to bypass proxy
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowProxyForm(false);
                  setProxyFormErrors({});
                }}
                className="px-3 py-1.5 bg-panel hover:bg-active rounded-md text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProxy}
                className="px-3 py-1.5 rounded-md text-sm"
                style={{
                  backgroundColor: 'var(--icon-primary)',
                  color: 'var(--ui-bg)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                {editingProxy ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsScreen;
