import { useSettings, ProxyConfig } from "@/core/settings/hooks/useSettings";
import { Check, RefreshCw, Plus, Trash2, Edit2, Palette, Type, FileText, Globe, Network, Terminal as TerminalIcon, Download, Search, Keyboard, WrapText, Timer  } from "lucide-react";
import { useEffect, useMemo, useState, useRef } from "react";
import { loadThemeById, getAvailableThemes } from "@/utils/themeLoader";
import { Kbd } from "@/core/components/ui/kbd";

// Validation constants (should match useSettings.ts)
const VALID_FONT_FAMILIES = [
  "Inconsolata",
  "Geist Mono",
  "JetBrains Mono",
  "Fira Code"
];

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 20;
const AUTO_SAVE_DELAY_MIN = 2;
const AUTO_SAVE_DELAY_MAX = 300;

type RowProps = {
  title: string;
  description: string;
  control: React.ReactNode;
  icon?: React.ReactNode;
};

const Row = ({ title, description, control, icon }: RowProps) => (
  <div className="flex items-start justify-between gap-4 py-4 hover:bg-panel/30 transition-all px-2 rounded-md">
    <div className="flex items-start gap-3 flex-1">
      {icon && <div className="mt-0.5" style={{ color: 'var(--icon-primary)' }}>{icon}</div>}
      <div className="flex-1">
        <div className="font-medium text-text mb-0.5">{title}</div>
        <div className="text-xs text-comment leading-relaxed">{description}</div>
      </div>
    </div>
    <div className="flex-shrink-0">{control}</div>
  </div>
);

type SectionHeaderProps = {
  title: string;
  icon: React.ReactNode;
  description?: string;
};

const SectionHeader = ({ title, icon, description }: SectionHeaderProps) => (
  <div className="mb-4">
    <div className="flex items-center gap-2 mb-1">
      <div style={{ color: 'var(--icon-primary)' }}>{icon}</div>
      <h2 className="text-lg font-bold text-text">{title}</h2>
    </div>
    {description && <p className="text-xs text-comment ml-7">{description}</p>}
  </div>
);

const Toggle = ({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <button
    onClick={() => !disabled && onChange(!checked)}
    disabled={disabled}
    className={`relative h-6 w-11 rounded-full transition ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    style={{
      backgroundColor: checked ? 'var(--icon-primary)' : 'rgb(107 114 128)' // gray-500
    }}
    aria-pressed={checked}
  >
    <span
      className={`absolute top-0.5 h-5 w-5 rounded-full bg-editor shadow transform transition ${
        checked ? "translate-x-0" : "translate-x-[-1.25rem]"
      }`}
    />
  </button>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`px-3 py-1.5 rounded-md bg-editor text-text border border-[--panel-border] focus:outline-none focus:ring-2`}
    style={{
      '--tw-ring-color': 'var(--icon-primary)'
    } as React.CSSProperties}
  />
);

export const SettingsScreen = () => {
  const { settings, loading, save, saveImmediate, reset, onChange } = useSettings();
  const [activeSection, setActiveSection] = useState("appearance");
  const [searchQuery, setSearchQuery] = useState("");

  const cursorTypes = useMemo(() => ["text", "default", "pointer"], []);
  const [fontFamilyDraft, setFontFamilyDraft] = useState("");
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
  const [cliMessage, setCliMessage] = useState<string | null>(null);

  const commonFonts = useMemo(() => VALID_FONT_FAMILIES, []);

  // Refs for scrolling
  const appearanceRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const networkRef = useRef<HTMLElement>(null);
  const updatesRef = useRef<HTMLElement>(null);
  const terminalRef = useRef<HTMLElement>(null);
  const cliRef = useRef<HTMLElement>(null);
  const keyboardRef = useRef<HTMLElement>(null);

  const sections = [
    { id: "appearance", label: "Appearance", icon: <Palette className="w-4 h-4" />, ref: appearanceRef },
    { id: "editor", label: "Editor", icon: <FileText className="w-4 h-4" />, ref: editorRef },
    { id: "network", label: "Network", icon: <Network className="w-4 h-4" />, ref: networkRef },
    { id: "updates", label: "Updates", icon: <Download className="w-4 h-4" />, ref: updatesRef },
    { id: "terminal", label: "Terminal", icon: <TerminalIcon className="w-4 h-4" />, ref: terminalRef },
    { id: "cli", label: "CLI", icon: <TerminalIcon className="w-4 h-4" />, ref: cliRef },
    { id: "keyboard", label: "Keyboard", icon: <Keyboard className="w-4 h-4" />, ref: keyboardRef },
  ];

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

  useEffect(() => {
    if (!loading && settings) {
      setFontFamilyDraft(settings.appearance.font_family ?? "");
    }
  }, [loading, settings?.appearance.font_family]);

  // Intersection Observer to update active section based on scroll position
  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: '0px 0px -80% 0px',
      threshold: 0,
    };

    let intersectingSections: { id: string; top: number }[] = [];

    const observerCallback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        const sectionId = entry.target.getAttribute('data-section');
        if (!sectionId) return;

        if (entry.isIntersecting) {
          const rect = entry.target.getBoundingClientRect();
          const existing = intersectingSections.find(s => s.id === sectionId);
          if (existing) {
            existing.top = rect.top;
          } else {
            intersectingSections.push({ id: sectionId, top: rect.top });
          }
        } else {
          intersectingSections = intersectingSections.filter(s => s.id !== sectionId);
        }
      });

      // Find the section closest to the top of the viewport
      if (intersectingSections.length > 0) {
        intersectingSections.sort((a, b) => a.top - b.top);
        setActiveSection(intersectingSections[0].id);
      }
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);

    // Observe all section refs
    sections.forEach((section) => {
      if (section.ref.current) {
        observer.observe(section.ref.current);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [sections]);

  if (loading || !settings) {
    return <div className="h-full w-full flex items-center justify-center text-comment">Loading settings…</div>;
  }

  const scrollToSection = (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (section?.ref.current) {
      section.ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      // console.error("Failed to uninstall font:", error);
    }
  };

  const handleSyncThemes = async () => {
    setIsSyncingThemes(true);
    setThemeSyncError(null);

    try {
      const result = await window.electron?.themes?.sync();
      if (result?.success) {
        // Reload the current theme to apply any updates
        const currentTheme = settings.appearance.theme || 'voiden';
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
    setCliMessage(null);

    try {
      const result = await window.electron?.cli?.install();
      if (result?.success) {
        setCliMessage(result.message);
        await saveImmediate({
          cli: {
            installed: true,
          },
        });
      } else {
        setCliMessage(result?.message || "Installation failed");
      }
    } catch (error) {
      setCliMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsInstallingCli(false);
    }
  };

  const handleCliUninstall = async () => {
    setIsInstallingCli(true);
    setCliMessage(null);

    try {
      const result = await window.electron?.cli?.uninstall();
      if (result?.success) {
        setCliMessage(result.message);
        await saveImmediate({
          cli: {
            installed: false,
          },
        });
      } else {
        setCliMessage(result?.message || "Uninstallation failed");
      }
    } catch (error) {
      setCliMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsInstallingCli(false);
    }
  };

  const handleShowCliInstructions = async () => {
    await window.electron?.cli?.showInstructions();
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
      <div className="w-56 bg-panel/30 border-r border-[--panel-border] flex flex-col">
        <div className="p-4 border-b border-[--panel-border]">
          <h1 className="text-lg font-semibold mb-3">Settings</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-comment" />
            <input
              type="text"
              placeholder="Search settings"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-editor border border-[--panel-border] rounded-md text-sm focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--icon-primary)' } as React.CSSProperties}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => scrollToSection(section.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all ${
                activeSection === section.id
                  ? "font-medium"
                  : "text-text/80 hover:bg-panel hover:text-text"
              }`}
              style={activeSection === section.id ? {
                backgroundColor: 'color-mix(in srgb, var(--icon-primary) 15%, transparent)',
                color: 'var(--icon-primary)'
              } : {}}
            >
              <span style={{ color: activeSection === section.id ? 'var(--icon-primary)' : 'var(--icon-secondary)' }}>
                {section.icon}
              </span>
              {section.label}
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-[--panel-border]">
          <button
            onClick={async () => {
              await reset();
              const resetSettings = await window.electron?.userSettings.get();
              if (resetSettings?.appearance?.theme) {
                await loadThemeById(resetSettings.appearance.theme);
              }
            }}
            className="w-full flex items-center justify-center gap-2 bg-panel hover:bg-active px-3 py-2 rounded-md text-sm border border-[--panel-border] transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Reset All
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-10">
          {/* Appearance */}
          <section ref={appearanceRef} data-section="appearance">
            <SectionHeader
              icon={<Palette className="w-5 h-5" />}
              title="Appearance"
              description="Customize the visual style of your editor"
            />
            <div className="border-b border-[--panel-border] mb-6"></div>
            <div>
              {matchesSearch("Theme Choose a color theme for the editor") && (
                <Row
                  icon={<Palette className="w-4 h-4" />}
                  title="Theme"
                  description="Choose a color theme for the editor."
                  control={
                    <div className="flex items-center gap-2">
                      <select
                        className="px-3 py-1.5 rounded-md bg-editor text-text border border-[--panel-border] focus:outline-none focus:ring-2 focus:ring-[var(--icon-primary)] min-w-[180px]"
                        value={settings.appearance.theme || "voiden"}
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
                      </select>
                      <button
                        onClick={handleSyncThemes}
                        disabled={isSyncingThemes}
                        className="p-1.5 rounded-md bg-panel hover:bg-active border border-[--panel-border] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Sync themes from app"
                      >
                        <RefreshCw className={`w-4 h-4 ${isSyncingThemes ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  }
                />
              )}
              {themeSyncError && (
                <div className="px-2 py-2 rounded text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--icon-error) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--icon-error) 30%, transparent)', borderWidth: '1px' }}>
                  <span style={{ color: 'var(--icon-error)' }}>Error syncing themes: {themeSyncError}</span>
                </div>
              )}
              {matchesSearch("Font size Base editor font size in pixels") && (
                <Row
                  icon={<Type className="w-4 h-4" />}
                  title="Font size"
                  description="Base editor font size in pixels."
                  control={
                  <select
                    className="px-3 py-1.5 rounded-md bg-editor text-text border border-[--panel-border] focus:outline-none focus:ring-2 focus:ring-[var(--icon-primary)] min-w-[180px]"
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
                  </select>
                }
                />
              )}
              {matchesSearch("Font family Select a monospace font for the editor") && (
                <Row
                  icon={<Type className="w-4 h-4" />}
                  title="Font family"
                  description="Select a monospace font for the editor."
                  control={
                  <select
                    className="px-3 py-1.5 rounded-md bg-editor text-text border border-[--panel-border] focus:outline-none focus:ring-2 focus:ring-[var(--icon-primary)] min-w-[180px]"
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
                  </select>
                }
                />
              )}

              {matchesSearch("Word Wrap") && (
                <Row
                  icon={<WrapText className="w-4 h-4" />}
                  title="Word Wrap"
                  description="Wrap text for long lines inside editor"
                  control={
                  <Toggle
                    checked={settings.appearance.code_wrap}
                    onChange={(v) => save({ appearance: { code_wrap: v } })}
                  />
                }
                />
              )}
            </div>
          </section>

          {/* Editor */}
          <section ref={editorRef} data-section="editor">
            <SectionHeader
              icon={<FileText className="w-5 h-5" />}
              title="Editor"
              description="Configure editor behavior and features"
            />
            <div className="border-b border-[--panel-border] mb-6"></div>
            <div>
              {matchesSearch("Auto save Automatically persist changes while typing") && (
                <Row
                  icon={<Check className="w-4 h-4" />}
                  title="Auto save"
                  description="Automatically persist changes while typing."
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
                  icon={<RefreshCw className="w-4 h-4" />}
                  title="Auto save delay"
                  description="How long to wait after typing before saving changes."
                  control={
                    <select
                      className="px-3 py-1.5 rounded-md bg-editor text-text border border-[--panel-border] focus:outline-none focus:ring-2 focus:ring-[var(--icon-primary)] min-w-[180px]"
                      value={settings.editor.auto_save_delay}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        save({ editor: { auto_save_delay: value } });
                      }}
                    >
                      <option value={5}>5 seconds</option>
                      <option value={10}>10 seconds</option>
                      <option value={30}>30 seconds</option>
                      <option value={60}>1 minute</option>
                      <option value={300}>5 minutes</option>
                      <option value={600}>10 minutes</option>
                      <option value={1800}>30 minutes</option>
                    </select>
                  }
                />
              )}
            </div>
          </section>

          {/* Network */}
          <section ref={networkRef} data-section="network">
            <SectionHeader
              icon={<Network className="w-5 h-5" />}
              title="Network"
              description="Configure network and proxy settings"
            />
            <div className="border-b border-[--panel-border] mb-6"></div>

            <div className="space-y-6">
              {/* Requests */}
              <div>
                <h3 className="text-sm font-semibold text-text mb-3">Requests</h3>
                {matchesSearch("Disable TLS Verification TLS verification development local testing") && (
                  <Row
                    icon={<Globe className="w-4 h-4" />}
                    title="Disable TLS Verification"
                    description="Disable TLS verification for development and local testing."
                    control={
                    <Toggle
                      checked={settings.requests.disable_tls_verification}
                      onChange={(v) => save({ requests: { disable_tls_verification: v } })}
                    />
                  }
                  />
                )}
                {matchesSearch("Request Timeout timeout limit seconds minutes") && (
                  <Row
                    icon={<Timer className="w-4 h-4" />}
                    title="Request Timeout"
                    description="Maximum time to wait for a response before aborting the request."
                    control={
                      <select
                        className="px-3 py-1.5 rounded-md bg-editor text-text border border-[--panel-border] focus:outline-none focus:ring-2 focus:ring-[var(--icon-primary)] min-w-[180px]"
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
                      </select>
                    }
                  />
                )}
              </div>

              {/* Proxy */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-text">Proxy</h3>
                  <button
                    onClick={handleAddProxy}
                    className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md transition-colors"
                    style={{
                      backgroundColor: 'var(--icon-primary)',
                      color: 'var(--ui-bg)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                  >
                    <Plus className="w-4 h-4" /> Add Proxy
                  </button>
                </div>

                <div className="space-y-3">
                  {settings.proxy.proxies.length === 0 ? (
                    <div className="text-sm text-comment p-4 bg-panel rounded-xl text-center">
                      No proxies configured. Click "Add Proxy" to create one.
                    </div>
                  ) : (
                    settings.proxy.proxies
                      .filter((proxy) => matchesSearch(`${proxy.name} ${proxy.host} proxy`))
                      .map((proxy) => {
                      const isActive = settings.proxy.activeProxyId === proxy.id;
                      return (
                        <div
                          key={proxy.id}
                          className={`flex items-start justify-between gap-4 rounded-xl p-4 transition ${
                            isActive ? 'border' : 'bg-panel hover:bg-active'
                          }`}
                          style={isActive ? {
                            backgroundColor: 'color-mix(in srgb, var(--icon-primary) 10%, transparent)',
                            borderColor: 'color-mix(in srgb, var(--icon-primary) 30%, transparent)'
                          } : {}}
                        >
                          <div className="flex-1">
                            <div className="font-medium text-text flex items-center gap-2">
                              {proxy.name}
                              {isActive && (
                                <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--icon-primary)', color: 'var(--ui-bg)' }}>
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-comment">
                              {proxy.host}:{proxy.port}
                              {proxy.auth && <span className="ml-2">• Auth enabled</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Toggle
                              checked={isActive}
                              onChange={() => handleToggleProxy(proxy.id)}
                            />
                            <button
                              onClick={() => handleEditProxy(proxy)}
                              className="p-1 hover:bg-panel rounded"
                              title="Edit proxy"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteProxy(proxy.id)}
                              className="p-1 hover:bg-panel rounded"
                              style={{ color: 'var(--icon-error)' }}
                              title="Delete proxy"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Updates */}
          <section ref={updatesRef} data-section="updates">
            <SectionHeader
              icon={<Download className="w-5 h-5" />}
              title="Updates"
              description="Manage application update preferences"
            />
            <div className="border-b border-[--panel-border] mb-6"></div>
            <div>
              {matchesSearch("Early Access early access new features updates beta") && (
                <Row
                  icon={<Download className="w-4 h-4" />}
                  title="Early Access"
                  description="Get early access to new features and updates. Early Access builds may be less stable than regular releases."
                  control={
                  <Toggle
                    checked={settings.updates.channel === "early-access"}
                    onChange={(v) => handleEarlyAccessToggle(v)}
                  />
                }
                />
              )}
            </div>
          </section>

          {/* Terminal */}
          <section ref={terminalRef} data-section="terminal">
            <SectionHeader
              icon={<TerminalIcon className="w-5 h-5" />}
              title="Terminal"
              description="Configure terminal appearance and fonts"
            />
            <div className="border-b border-[--panel-border] mb-6"></div>
            <div>
              {matchesSearch("Use Nerd Font terminal font JetBrains Mono icons") && (
                <div className="py-4 hover:bg-panel/30 transition-all px-2 rounded-md">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="mt-0.5" style={{ color: 'var(--icon-primary)' }}><Type className="w-4 h-4" /></div>
                      <div className="flex-1">
                        <div className="font-medium text-text mb-0.5">Use Nerd Font</div>
                      <div className="text-xs text-comment leading-relaxed">
                        Download and use JetBrains Mono Nerd Font for better icon support in terminal.
                        {settings.terminal.nerd_font_installed && !isDownloadingFont && (
                          <span className="inline-flex items-center gap-1 ml-1" style={{ color: 'var(--icon-success)' }}>
                            <Check className="w-3 h-3" /> Font installed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex-shrink-0 ml-3">
                    <Toggle
                      checked={settings.terminal.use_nerd_font}
                      onChange={handleNerdFontToggle}
                      disabled={isDownloadingFont}
                    />
                  </div>
                </div>

                {isDownloadingFont && (
                  <div className="mt-3 p-3 rounded text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--icon-primary) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--icon-primary) 30%, transparent)', borderWidth: '1px' }}>
                    <div className="flex items-center gap-2">
                      <div className="animate-spin h-4 w-4 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--icon-primary)', borderTopColor: 'transparent' }}></div>
                      <span style={{ color: 'var(--icon-primary)' }}>Downloading font (~112MB)...</span>
                    </div>
                  </div>
                )}

                {fontDownloadError && (
                  <div className="mt-3 p-3 rounded text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--icon-error) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--icon-error) 30%, transparent)', borderWidth: '1px' }}>
                    <span style={{ color: 'var(--icon-error)' }}>Error: {fontDownloadError}</span>
                  </div>
                )}

                {settings.terminal.nerd_font_installed && !isDownloadingFont && (
                  <div className="mt-3 pt-3 border-t border-[--panel-border]">
                    <button
                      onClick={handleUninstallFont}
                      className="text-sm transition"
                      style={{ color: 'var(--icon-error)' }}
                    >
                      Uninstall Font
                    </button>
                    <p className="text-xs text-comment mt-1">
                      This will delete the downloaded font files.
                    </p>
                  </div>
                )}
                </div>
              )}
            </div>
          </section>

          {/* CLI */}
          <section ref={cliRef} data-section="cli">
            <SectionHeader
              icon={<TerminalIcon className="w-5 h-5" />}
              title="Command Line Interface"
              description="Install the voiden command to launch Voiden from your terminal"
            />
            <div className="border-b border-[--panel-border] mb-6"></div>
            <div>
              {matchesSearch("CLI command line terminal voiden install") && (
                <div className="space-y-4">
                  <div className="py-4 hover:bg-panel/30 transition-all px-2 rounded-md">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="mt-0.5" style={{ color: 'var(--icon-primary)' }}><TerminalIcon className="w-4 h-4" /></div>
                      <div className="flex-1">
                        <div className="font-medium text-text mb-0.5">Voiden CLI</div>
                        <div className="text-xs text-comment leading-relaxed">
                          Install the <code className="px-1 py-0.5 bg-panel rounded text-xs">voiden</code> command to launch Voiden from your terminal.
                          {settings.cli?.installed && (
                            <span className="inline-flex items-center gap-1 ml-1" style={{ color: 'var(--icon-success)' }}>
                              <Check className="w-3 h-3" /> CLI installed
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-7">
                      {!settings.cli?.installed ? (
                        <>
                          <button
                            onClick={handleCliInstall}
                            disabled={isInstallingCli}
                            className="px-4 py-2 rounded-md text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              backgroundColor: 'var(--icon-primary)',
                              color: 'var(--ui-bg)'
                            }}
                            onMouseEnter={(e) => !isInstallingCli && (e.currentTarget.style.opacity = '0.9')}
                            onMouseLeave={(e) => !isInstallingCli && (e.currentTarget.style.opacity = '1')}
                          >
                            {isInstallingCli ? "Installing..." : "Install CLI"}
                          </button>
                          <button
                            onClick={handleShowCliInstructions}
                            className="px-4 py-2 bg-panel hover:bg-active rounded-md text-sm border border-[--panel-border] transition"
                          >
                            Show Instructions
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={handleCliUninstall}
                          disabled={isInstallingCli}
                          className="px-4 py-2 rounded-md text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            backgroundColor: 'var(--icon-error)',
                            color: 'var(--ui-bg)'
                          }}
                          onMouseEnter={(e) => !isInstallingCli && (e.currentTarget.style.opacity = '0.9')}
                          onMouseLeave={(e) => !isInstallingCli && (e.currentTarget.style.opacity = '1')}
                        >
                          {isInstallingCli ? "Uninstalling..." : "Uninstall CLI"}
                        </button>
                      )}
                    </div>

                    {cliMessage && (
                      <div className="mt-3 p-3 rounded text-sm ml-7" style={{ backgroundColor: 'color-mix(in srgb, var(--icon-primary) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--icon-primary) 30%, transparent)', borderWidth: '1px' }}>
                        <pre className="whitespace-pre-wrap text-xs font-mono" style={{ color: 'var(--icon-primary)' }}>
                          {cliMessage}
                        </pre>
                      </div>
                    )}

                    <div className="mt-4 p-3 bg-panel rounded-xl text-xs ml-7">
                      <p className="font-medium mb-2 text-text">Usage Examples:</p>
                      <code className="block text-comment mb-1">voiden file.void</code>
                      <code className="block text-comment mb-1">voiden /path/to/project</code>
                      <code className="block text-comment">voiden --help</code>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Keyboard Shortcuts */}
          <section ref={keyboardRef} data-section="keyboard">
            <SectionHeader
              icon={<Keyboard className="w-5 h-5" />}
              title="Keyboard Shortcuts"
              description="View all keyboard shortcuts for quick actions"
            />
            <div className="border-b border-[--panel-border] mb-6"></div>
            <div className="space-y-6">
              {keyboardShortcuts.map((group) => {
                const filteredShortcuts = group.shortcuts.filter(
                  (shortcut) => matchesSearch(`${shortcut.description} ${shortcut.keys} ${group.category}`)
                );

                if (filteredShortcuts.length === 0) return null;

                return (
                  <div key={group.category}>
                    <h3 className="text-sm font-semibold text-text mb-3">{group.category}</h3>
                    <div className="space-y-2">
                      {filteredShortcuts.map((shortcut, index) => (
                        <div key={index} className="flex items-center justify-between py-2 px-3 hover:bg-panel/30 rounded-md">
                          <span className="text-sm text-text">{shortcut.description}</span>
                          <Kbd keys={shortcut.keys} size="md" />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="pt-8 pb-4 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-panel/50 border border-[--panel-border]">
              <Check className="w-3.5 h-3.5" style={{ color: 'var(--icon-success)' }} />
              <span className="text-xs text-comment">Changes save automatically</span>
            </div>
          </div>
        </div>
      </div>

      {/* Proxy Form Modal */}
      {showProxyForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-editor border border-[--panel-border] rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">
              {editingProxy ? 'Edit Proxy' : 'Add Proxy'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-comment mb-1">Name</label>
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
                <label className="block text-sm text-comment mb-1">Host</label>
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
                <label className="block text-sm text-comment mb-1">Port</label>
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
                <label className="text-sm text-comment">Authentication</label>
                <Toggle
                  checked={proxyForm.auth}
                  onChange={(v) => setProxyForm({ ...proxyForm, auth: v })}
                />
              </div>

              {proxyForm.auth && (
                <>
                  <div>
                    <label className="block text-sm text-comment mb-1">Username</label>
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
                    <label className="block text-sm text-comment mb-1">Password</label>
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
                <label className="block text-sm text-comment mb-1">
                  Excluded Domains (optional)
                </label>
                <Input
                  value={proxyForm.excludedDomains}
                  onChange={(e) => setProxyForm({ ...proxyForm, excludedDomains: e.target.value })}
                  placeholder="localhost, 127.0.0.1, *.internal"
                />
                <p className="text-xs text-comment mt-1">
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
                className="px-4 py-2 bg-panel hover:bg-active rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProxy}
                className="px-4 py-2 rounded-md"
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
