import * as https from "node:https";
import { app } from "electron";
import { getSettings, saveSettings } from "../settings";
import { activityHeaders, utcDay } from "./activity";

// The plugin registry is served by voiden.md, which mirrors
// VoidenHQ/plugin-registry. GitHub stays as a fallback so plugins keep working
// if voiden.md is unreachable.
const REGISTRY_URL = "https://voiden.md/api/plugins/registry";
const REGISTRY_FALLBACK_URL = "https://raw.githubusercontent.com/VoidenHQ/plugin-registry/main/extensions.json";
const TIMEOUT_MS = 10_000;

// Use Node.js https instead of fetch() — fetch() in the Electron main process
// routes through Chromium's network service which can crash under load at startup.
function httpsGet(url: string, headers: Record<string, string>, redirects = 1): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        httpsGet(new URL(res.headers.location, url).toString(), headers, redirects - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function baseHeaders(): Record<string, string> {
  return {
    // Same form as the update check (updates.ts), which voiden.md already parses.
    "User-Agent": `Voiden/${app.getVersion()} (${process.platform}: ${process.arch})`,
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}

async function fetchRegistry(): Promise<any> {
  const today = utcDay(new Date());
  const activity = activityHeaders(getSettings().activity ?? {}, new Date());
  try {
    const parsed = JSON.parse(await httpsGet(REGISTRY_URL, { ...baseHeaders(), ...activity }));
    // Reported: remember the day so the rest of today's requests carry no flags.
    if (activity["X-Voiden-Active"]) {
      try {
        saveSettings({ activity: { ...getSettings().activity, last_active: today } });
      } catch {
        // Not being able to save only means today is reported again.
      }
    }
    return parsed;
  } catch {
    return JSON.parse(await httpsGet(REGISTRY_FALLBACK_URL, baseHeaders()));
  }
}

let inFlight: Promise<any> | null = null;

/**
 * Fetch and parse the plugin registry (extensions.json). Concurrent callers
 * share one request, so the activity flags are sent once.
 */
export function fetchPluginRegistry(): Promise<any> {
  if (!inFlight) {
    inFlight = fetchRegistry().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
