import { app, ipcMain, BrowserWindow, dialog } from "electron";
import fs from "fs";
import path from "path";

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

export type Settings = {
  appearance: {
    theme?: string;
    font_size: number;
    font_family: string;
    ui_font_size: number;
    cursor_type: "text" | "default" | "pointer";
    code_wrap: boolean;
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
  cli: {
    installed: boolean; // Whether CLI is currently installed in PATH
  };
  skills: {
    claude: boolean;
    codex: boolean;
  };
  projects: {
    default_directory: string;
  };
  history?: {
    enabled?: boolean;
    retention_days?: number;
  };
};

const userFile = path.join(app.getPath("userData"), "settings.json");

// In dev you may want a different path; in prod use process.resourcesPath.
const defaultsFile = app.isPackaged
  ? path.join(process.resourcesPath, "default.settings.json")
  : path.join(__dirname, "../../default.settings.json");

function readJSON<T>(p: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  const out: any = Array.isArray(base)
    ? [...(base as any)]
    : { ...(base as any) };
  for (const [k, v] of Object.entries(override ?? {})) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof (out as any)[k] === "object"
    ) {
      (out as any)[k] = deepMerge((out as any)[k], v as any);
    } else {
      (out as any)[k] = v;
    }
  }
  return out;
}

let cache: Settings;

export function getDefaultProjectsDirectory() {
  return path.join(app.getPath("home"), "Voiden");
}

function normalizeSettings(settings: Settings): Settings {
  const next = { ...settings };

  if (!next.cli) {
    next.cli = { installed: false };
  }

  if (!next.projects) {
    next.projects = { default_directory: getDefaultProjectsDirectory() };
  }

  const trimmedDirectory = next.projects.default_directory?.trim();
  next.projects.default_directory = trimmedDirectory
    ? path.resolve(trimmedDirectory)
    : getDefaultProjectsDirectory();

  return next;
}

export function loadSettings(): Settings {
  const defaults = readJSON<Settings>(defaultsFile);
  if (!defaults) throw new Error("default.settings.json missing or invalid");

  const user = readJSON<Partial<Settings>>(userFile) ?? {};

  // Auto-detect beta channel BEFORE merging with defaults
  // If the app version contains "-beta" and the user hasn't explicitly set a channel,
  // inject "early-access" into user settings so it overrides the default
  const appVersion = app.getVersion();
  const isBetaVersion = appVersion.includes("-beta");
  const hasUserSetChannel = user.updates?.channel !== undefined;

  if (isBetaVersion && !hasUserSetChannel) {
    // Inject early-access preference into user settings before merge
    if (!user.updates) {
      user.updates = { channel: "early-access" };
    } else {
      user.updates.channel = "early-access";
    }
  }

  // Now merge: user settings (potentially with beta channel) override defaults
  cache = normalizeSettings(deepMerge(defaults, user));

  // Clamp retention_days so a hand-edited JSON cannot bypass limits
  if ((cache as any).history?.retention_days !== undefined) {
    (cache as any).history.retention_days = Math.min(90, Math.max(1, Number((cache as any).history.retention_days) || 2));
  }

  // Ensure file exists with current settings
  try {
    fs.mkdirSync(path.dirname(userFile), { recursive: true });
    fs.writeFileSync(userFile, JSON.stringify(cache, null, 2));
  } catch {}

  return cache;
}

export function getSettings(): Settings {
  return cache ?? loadSettings();
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const merged = deepMerge(getSettings(), patch);
  // Clamp retention_days so values outside [1, 90] can never be persisted
  if ((merged as any).history?.retention_days !== undefined) {
    (merged as any).history.retention_days = Math.min(90, Math.max(1, Number((merged as any).history.retention_days) || 2));
  }
  fs.writeFileSync(userFile, JSON.stringify(merged, null, 2));
  cache = merged;

  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send("settings:changed", merged);
  }

  return cache;
}

export function resetSettings(): Settings {
  const defaults = readJSON<Settings>(defaultsFile);
  if (!defaults) throw new Error("default.settings.json missing or invalid");
  cache = normalizeSettings(defaults);
  fs.writeFileSync(userFile, JSON.stringify(cache, null, 2));
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send("settings:changed", cache);
  }
  return cache;
}

export async function toggleEarlyAccess(
  enable: boolean,
): Promise<{ confirmed: boolean; settings?: Settings }> {
  const focusedWindow = BrowserWindow.getFocusedWindow();

  const result = await dialog.showMessageBox(
    focusedWindow || BrowserWindow.getAllWindows()[0],
    {
      type: "warning",
      title: "Restart Required",
      message: enable ? "Enable Early Access?" : "Disable Early Access?",
      detail: enable
        ? "Toggling Early Access will restart the application to apply changes. You'll get early access to new features and updates, but builds may be less stable.\n\nDo you want to continue?"
        : "Toggling Early Access will restart the application to apply changes.\n\nDo you want to continue?",
      buttons: ["Restart Now", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    },
  );

  if (result.response === 0) {
    // User clicked "Restart Now"
    // Save the setting first
    const newSettings = saveSettings({
      updates: {
        channel: enable ? "early-access" : "stable",
      },
    });

    // Schedule restart after a short delay to allow response to be sent
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 100);

    return { confirmed: true, settings: newSettings };
  }

  // User clicked "Cancel" - don't change anything
  return { confirmed: false };
}

export function registerSettingsIpc() {
  // Load settings on startup to ensure file exists and cache is populated
  loadSettings();

  ipcMain.handle("usersettings:get", () => getSettings());
  ipcMain.handle("usersettings:set", (_e, patch: Partial<Settings>) =>
    saveSettings(patch),
  );
  ipcMain.handle("usersettings:reset", () => resetSettings());
  ipcMain.handle("usersettings:toggleEarlyAccess", (_e, enable: boolean) =>
    toggleEarlyAccess(enable),
  );
}
