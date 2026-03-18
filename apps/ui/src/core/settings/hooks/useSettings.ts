import { useElectronEvent } from "@/core/providers";
import { loadThemeById } from "@/utils/themeLoader";
import { useEffect, useMemo, useRef, useState } from "react";

// Valid font families from SettingsScreen
const VALID_FONT_FAMILIES = [
  "System Default",
  "Inconsolata",
  "Geist Mono",
  "JetBrains Mono",
  "Fira Code"
];

// System Default maps to platform monospace stack
const SYSTEM_DEFAULT_MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

// Validation ranges
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 20;
const UI_FONT_SIZE_MIN = 10;
const UI_FONT_SIZE_MAX = 16;
const AUTO_SAVE_DELAY_MIN = 0;
const AUTO_SAVE_DELAY_MAX = 300;
const CONTENT_WIDTH_MIN = 600;
const CONTENT_WIDTH_MAX = 1400;

// Validation function
function validateSettings(settings: UserSettings): UserSettings {
  const validated = { ...settings };

  // Validate font size
  if (typeof validated.appearance.font_size !== 'number' ||
    validated.appearance.font_size < FONT_SIZE_MIN ||
    validated.appearance.font_size > FONT_SIZE_MAX) {
    validated.appearance.font_size = 14; // Default fallback
  }

  // Validate font family
  if (!validated.appearance.font_family ||
    !VALID_FONT_FAMILIES.includes(validated.appearance.font_family)) {
    validated.appearance.font_family = "Inconsolata"; // Default fallback
  }

  // Validate UI font size
  if (typeof validated.appearance.ui_font_size !== 'number' ||
    validated.appearance.ui_font_size < UI_FONT_SIZE_MIN ||
    validated.appearance.ui_font_size > UI_FONT_SIZE_MAX) {
    validated.appearance.ui_font_size = 13; // Default fallback
  }

  // Validate content width
  if (typeof validated.appearance.content_width !== 'number' ||
    validated.appearance.content_width < CONTENT_WIDTH_MIN ||
    validated.appearance.content_width > CONTENT_WIDTH_MAX) {
    validated.appearance.content_width = 860; // Default fallback
  }

  // Validate auto save delay
  if (validated.editor.auto_save) {
    if (typeof validated.editor.auto_save_delay !== 'number' ||
      validated.editor.auto_save_delay < AUTO_SAVE_DELAY_MIN ||
      validated.editor.auto_save_delay > AUTO_SAVE_DELAY_MAX) {
      validated.editor.auto_save_delay = 5; // Default fallback
    }
  }

  // Validate request timeout
  if (typeof validated.requests?.timeout !== 'number' || validated.requests.timeout < 0) {
    if (!validated.requests) {
      (validated as any).requests = { disable_tls_verification: false, timeout: 300 };
    } else {
      validated.requests.timeout = 300;
    }
  }

  // Validate proxy settings
  if (!validated.proxy) {
    validated.proxy = {
      enabled: false,
      proxies: [],
    };
  }

  // Ensure proxy is an object with required fields
  if (typeof validated.proxy !== 'object') {
    validated.proxy = {
      enabled: false,
      proxies: [],
    };
  }

  // Ensure proxies is an array
  if (!Array.isArray(validated.proxy.proxies)) {
    validated.proxy.proxies = [];
  }

  // Validate each proxy config
  const beforeValidation = validated.proxy.proxies.length;
  validated.proxy.proxies = validated.proxy.proxies.filter((proxy: any) => {
    // Basic validation
    const basicValid = (
      proxy &&
      typeof proxy.id === 'string' &&
      typeof proxy.name === 'string' &&
      typeof proxy.host === 'string' &&
      typeof proxy.port === 'number' &&
      proxy.port > 0 &&
      proxy.port <= 65535 &&
      typeof proxy.auth === 'boolean'
    );

    if (!basicValid) {
      return false;
    }

    // Validate optional fields if present
    if (proxy.username !== undefined && typeof proxy.username !== 'string') {
      return false;
    }

    if (proxy.password !== undefined && typeof proxy.password !== 'string') {
      return false;
    }

    if (proxy.excludedDomains !== undefined) {
      if (!Array.isArray(proxy.excludedDomains)) {
        return false;
      }
      for (const domain of proxy.excludedDomains) {
        if (typeof domain !== 'string') {
          return false;
        }
      }
    }

    return true;
  });
  const afterValidation = validated.proxy.proxies.length;
  if (beforeValidation !== afterValidation) {
  }

  // Validate activeProxyId exists in proxies array
  if (validated.proxy.activeProxyId) {
    const activeExists = validated.proxy.proxies.some(
      (p: ProxyConfig) => p.id === validated.proxy.activeProxyId
    );
    if (!activeExists) {
      delete validated.proxy.activeProxyId;
    }
  }

  // Validate terminal settings
  if (!validated.terminal) {
    validated.terminal = {
      use_nerd_font: false,
      nerd_font_installed: false,
    };
  }

  if (typeof validated.terminal.use_nerd_font !== 'boolean') {
    validated.terminal.use_nerd_font = false;
  }

  if (typeof validated.terminal.nerd_font_installed !== 'boolean') {
    validated.terminal.nerd_font_installed = false;
  }

  // Validate update settings
  if (!validated.updates) {
    validated.updates = {
      channel: "stable",
    };
  }

  if (validated.updates.channel !== "stable" && validated.updates.channel !== "early-access") {
    validated.updates.channel = "stable";
  }

  return validated;
}

export type ProxyConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  auth: boolean;
  username?: string;
  password?: string;
  excludedDomains?: string[]; // Domains to bypass proxy (e.g., localhost, 127.0.0.1)
};

export type UserSettings = {
  appearance: {
    theme?: string;
    font_size: number;
    font_family: string;
    ui_font_size: number;
    cursor_type: "text" | "default" | "pointer";
    code_wrap: boolean;
    content_width: number; // px, max width for document content area
  };
  editor: {
    auto_save: boolean;
    auto_save_delay: number; // seconds
  };
  requests: {
    disable_tls_verification: boolean;
    timeout: number; // seconds, 0 = no limit
  };
  proxy: {
    enabled: boolean;
    proxies: ProxyConfig[];
    activeProxyId?: string;
  };
  terminal: {
    use_nerd_font: boolean;
    nerd_font_installed: boolean;
  };
  updates: {
    channel: "stable" | "early-access";
  };
};

function useDebounced(fn: (...a: any[]) => void, ms: number) {
  const t = useRef<any>();
  return (...a: any[]) => {
    clearTimeout(t.current);
    t.current = setTimeout(() => fn(...a), ms);
  };
}

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (settings?.appearance?.font_size) {
      document.documentElement.style.setProperty(
        "--font-size-base",
        `${settings.appearance.font_size}px`
      );
    }
  }, [settings?.appearance?.font_size]);


  useEffect(() => {
    if (settings?.appearance?.font_family) {
      const cssFont = settings.appearance.font_family === "System Default"
        ? SYSTEM_DEFAULT_MONO
        : `"${settings.appearance.font_family}", monospace`;
      document.documentElement.style.setProperty("--font-family-base", cssFont);
      document.documentElement.style.setProperty("--font-family-mono", cssFont);
    }
  }, [settings?.appearance?.font_family]);

  useEffect(() => {
    if (settings?.appearance?.ui_font_size) {
      document.documentElement.style.setProperty(
        "--font-size-ui",
        `${settings.appearance.ui_font_size}px`
      );
    }
  }, [settings?.appearance?.ui_font_size]);

  useEffect(() => {
    if (settings?.appearance?.content_width) {
      document.documentElement.style.setProperty(
        "--prose-max-width",
        `${settings.appearance.content_width}px`
      );
    }
  }, [settings?.appearance?.content_width]);


  useEffect(() => {
    let cancelled = false;
    window.electron?.userSettings.get().then((s) => {
      if (!cancelled) {
        const validatedSettings = validateSettings(s);
        setSettings(validatedSettings);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveImmediate = async (patch: Partial<UserSettings>) => {
    // Deep merge patch with current settings
    const currentSettings = settings || {} as UserSettings;
    const mergedSettings = {
      ...currentSettings,
      appearance: { ...currentSettings.appearance, ...patch.appearance },
      editor: { ...currentSettings.editor, ...patch.editor },
      requests: { ...currentSettings.requests, ...patch.requests },
      proxy: { ...currentSettings.proxy, ...patch.proxy },
      terminal: { ...currentSettings.terminal, ...patch.terminal },
      updates: { ...currentSettings.updates, ...patch.updates },
    };
    const validatedSettings = validateSettings(mergedSettings as UserSettings);

    const next = await window.electron?.userSettings.set(validatedSettings);
    setSettings(next);
  };

  const save = useDebounced(saveImmediate, 250);

  const reset = async () => {
    const next = await window.electron?.userSettings.reset();
    setSettings(next);
  };

  useElectronEvent("settings:changed", async () => {
    const settings: UserSettings = await window.electron?.userSettings.get()
    const validatedSettings = validateSettings(settings);
    setSettings(validatedSettings);
    if (settings && settings.appearance && settings.appearance.theme) {
      await loadThemeById(settings.appearance.theme);
    }
  })

  const onChange = (callback?: (next: UserSettings) => void) => {
    const off = window.electron?.userSettings.onChange((raw: UserSettings) => {
      const validated = validateSettings(raw);
      setSettings(validated);
      callback?.(validated);
    });
    return typeof off === "function" ? off : () => { };
  };

  return { settings, loading, save, saveImmediate, reset, setSettings, onChange };
}
