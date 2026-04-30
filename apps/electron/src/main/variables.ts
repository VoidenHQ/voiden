import path from "path";
import { getActiveProject, getAppState } from "./state";
import fs from "node:fs/promises";
import { ipcMain } from "electron";
import { windowManager } from "./windowManager";

export const GLOBAL_ENV_KEY = "__global__";

// ─── Storage format ───────────────────────────────────────────────────────────
//
// .voiden/.process.env.json  (new env-scoped format):
//   {
//     "__global__": { "KEY": "value" },       ← no active env / always available
//     "stage":      { "TOKEN": "abc" },       ← set while "stage" env was active
//     "production.eu": { ... }
//   }
//
// Migration: if any root value is not a plain object, the file is in the old
// flat format ({ "KEY": "value" }) and is automatically promoted to
// { "__global__": <original> } on first read.
// ─────────────────────────────────────────────────────────────────────────────

async function getVariablesFilePath(): Promise<string | null> {
    const activeProject = await getActiveProject();
    if (!activeProject) return null;
    const directory = path.join(activeProject, ".voiden");
    try { await fs.access(directory); } catch { await fs.mkdir(directory, { recursive: true }); }
    return path.join(directory, ".process.env.json");
}

function isOldFlatFormat(raw: Record<string, any>): boolean {
    return Object.values(raw).some(
        (v) => typeof v !== "object" || v === null || Array.isArray(v)
    );
}

async function readScopedObject(): Promise<Record<string, Record<string, any>>> {
    const filePath = await getVariablesFilePath();
    if (!filePath) return {};
    try {
        const data = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(data);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        // Auto-migrate old flat format
        if (isOldFlatFormat(parsed)) return { [GLOBAL_ENV_KEY]: parsed };
        return parsed as Record<string, Record<string, any>>;
    } catch (error: any) {
        if (error.code !== "ENOENT") console.error("Error reading variables file:", error);
        return {};
    }
}

async function writeScopedObject(scoped: Record<string, Record<string, any>>): Promise<void> {
    const filePath = await getVariablesFilePath();
    if (!filePath) return;
    await fs.writeFile(filePath, JSON.stringify(scoped, null, 2), "utf-8");
    windowManager.browserWindow?.webContents.send("files:tree:changed", null);
}

/** Returns merged vars for an env: global fallback + env-specific override. */
export async function readMergedForEnv(envKey?: string | null): Promise<Record<string, any>> {
    const scoped = await readScopedObject();
    const global = scoped[GLOBAL_ENV_KEY] ?? {};
    if (!envKey || envKey === GLOBAL_ENV_KEY) return global;
    return { ...global, ...(scoped[envKey] ?? {}) };
}

/** Returns only the env-specific (or global) vars without merging. */
async function readBucketOnly(envKey?: string | null): Promise<Record<string, any>> {
    const scoped = await readScopedObject();
    const key = !envKey || envKey === GLOBAL_ENV_KEY ? GLOBAL_ENV_KEY : envKey;
    return scoped[key] ?? {};
}

/** Gets the active env key from app state. Falls back to GLOBAL_ENV_KEY. */
export async function getActiveEnvKey(): Promise<string> {
    try {
        const state = getAppState();
        const dir = state.activeDirectory;
        const activeEnv = dir ? state.directories[dir]?.activeEnv : null;
        return activeEnv || GLOBAL_ENV_KEY;
    } catch {
        return GLOBAL_ENV_KEY;
    }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle("variables:getKeys", async (_event, envKey?: string) => {
    const vars = envKey !== undefined
        ? await readBucketOnly(envKey)
        : await readMergedForEnv(await getActiveEnvKey());
    return Object.keys(vars);
});

// Returns merged (global + env-specific) vars for the requested env.
// If envKey is omitted, uses the currently active env.
// Pass "__global__" explicitly to get only global vars.
ipcMain.handle("variables:read", async (_event, envKey?: string) => {
    const key = envKey !== undefined ? envKey : await getActiveEnvKey();
    // When a specific env is requested from the UI editor, return only that bucket
    // (not merged) so users can see what belongs to each env separately.
    if (envKey !== undefined) return readBucketOnly(envKey);
    return readMergedForEnv(key);
});

ipcMain.handle("variables:readMerged", async (_event, envKey?: string) => {
    const key = envKey !== undefined ? envKey : await getActiveEnvKey();
    return readMergedForEnv(key);
});

ipcMain.handle("variables:get", async (_event, key: string, envKey?: string) => {
    const vars = await readMergedForEnv(envKey ?? await getActiveEnvKey());
    return vars[key];
});

ipcMain.handle("variables:set", async (_event, key: string, value: any, envKey?: string) => {
    const targetKey = envKey ?? await getActiveEnvKey();
    const scoped = await readScopedObject();
    const bucket = scoped[targetKey] ?? {};
    bucket[key] = value;
    scoped[targetKey] = bucket;
    await writeScopedObject(scoped);
    return true;
});

ipcMain.handle("variables:writeVariables", async (_event, content: string | Record<string, any>, envKey?: string) => {
    try {
        const incoming: Record<string, any> = typeof content === "string"
            ? JSON.parse(content || "{}")
            : content ?? {};
        const targetKey = envKey ?? await getActiveEnvKey();
        const scoped = await readScopedObject();
        scoped[targetKey] = incoming;
        await writeScopedObject(scoped);
    } catch (error) {
        console.error("Error writing variables file:", error);
    }
});

ipcMain.handle("variables:getActiveEnvKey", async (_event) => {
    return getActiveEnvKey();
});

ipcMain.handle("variables:deleteKey", async (_event, key: string, envKey?: string) => {
    try {
        const targetKey = envKey ?? await getActiveEnvKey();
        const scoped = await readScopedObject();
        if (scoped[targetKey]) {
            delete scoped[targetKey][key];
            await writeScopedObject(scoped);
        }
    } catch (error) {
        console.error("Error deleting variable:", error);
    }
});

// ─── Exported helpers for use inside electron main process ────────────────────

/** Load flat merged vars for the currently active env (for scripts/replace). */
export async function loadVariablesForActive(): Promise<Record<string, any>> {
    return readMergedForEnv(await getActiveEnvKey());
}

/** Merge-write new variables into the currently active env bucket. */
export async function mergeWriteVariablesForActive(newVars: Record<string, any>): Promise<void> {
    const targetKey = await getActiveEnvKey();
    const scoped = await readScopedObject();
    scoped[targetKey] = { ...(scoped[targetKey] ?? {}), ...newVars };
    await writeScopedObject(scoped);
}
