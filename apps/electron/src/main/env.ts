import path from "path";
import { getActiveProject, getAppState } from "./state";
import fs from "node:fs/promises";
import { ipcMain, IpcMainInvokeEvent } from "electron";
import { saveState } from "./persistState";
import merge from "lodash/merge";
import YAML from "yaml";

/**
 * Type definitions for YAML environment system
 */
interface YamlEnvNode {
  variables?: Record<string, string>;
  children?: Record<string, YamlEnvNode>;
  intermediate?: boolean;
  displayName?: string;
}

interface YamlEnvTree {
  [key: string]: YamlEnvNode;
}

interface EnvLoadResult {
  activeEnv: string | null;
  data: Record<string, Record<string, string>>;
  displayNames: Record<string, string>;
  // Project-relative path of the active profile's YAML file, e.g.
  // ".voiden/env-public.yaml" or, pre-migration, "env-public.yaml" at the
  // project root. Undefined when data came from the legacy per-file .env
  // fallback instead — those entries are already real individual paths.
  profileFile?: string;
  // For environments discovered inside a nested .voiden/ directory elsewhere
  // in a monorepo (see findNestedCandidateDirs below): maps that env's data key
  // to the folder (project-relative, no filename) it was found in. Absent
  // for the active project's own environments.
  sourcePaths?: Record<string, string>;
  // Same keys as sourcePaths — maps to the profile name that nested env
  // came from (e.g. "default" or a legacy root-level named profile), so
  // callers can tell apart two environments that share a folder.
  sourceProfiles?: Record<string, string>;
}

/**
 * Parse the content of a .env file into an object.
 */
function parseEnvContent(content: string) {
  const env: Record<string, string> = {};
  content.split(/\r?\n/).forEach((line) => {
    line = line.trim();
    if (!line || line.startsWith("#")) return;

    const eqIndex = line.indexOf("=");
    if (eqIndex < 0) return; // Skip malformed lines

    const key = line.substring(0, eqIndex).trim();
    let value = line.substring(eqIndex + 1).trim();

    // Remove optional surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.substring(1, value.length - 1);
    }

    env[key] = value;
  });
  return env;
}

/**
 * Find files starting with ".env" directly inside one directory (no
 * recursion into subdirectories). Returns an array of absolute file paths.
 */
async function findEnvFilesInDir(dir: string) {
  const envFiles: string[] = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    return envFiles;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith(".env")) {
      envFiles.push(path.join(dir, entry.name));
    }
  }

  return envFiles;
}

/**
 * Load all legacy flat .env files for a project. Scoped to exactly two
 * places — the project root and .voiden/ — never recursed into arbitrary
 * subdirectories. This used to walk the entire project tree looking for
 * any .env-prefixed file anywhere, which (since this only runs at all when
 * a project has no .voiden/ YAML environments set up) meant a stray .env in
 * node_modules, a nested app folder, or anywhere else unrelated to this
 * project's own config could get silently discovered and merged into every
 * request's variable resolution.
 * If there are duplicate keys, later files in the array will override earlier ones.
 */
async function loadProjectEnv(projectPath: string) {
  const envData: Record<string, Record<string, string>> = {};

  const envFiles = [
    ...(await findEnvFilesInDir(projectPath)),
    ...(await findEnvFilesInDir(path.join(projectPath, VOIDEN_DIR))),
  ];

  // Sort the file paths to ensure a consistent order.
  envFiles.sort((a, b) => a.localeCompare(b));

  for (const filePath of envFiles) {
    let content;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (err) {
      continue;
    }
    const parsedEnv = parseEnvContent(content);

    // Use the full file path as the key
    envData[filePath] = parsedEnv;
  }

  return envData;
}

/**
 * Flatten a YAML environment tree into a flat map of environment names to variables.
 * Handles inheritance - child environments inherit parent variables.
 * @param tree The YAML environment tree
 * @param prefix Current path prefix (for recursion)
 * @param parentVars Variables inherited from parent (for recursion)
 */
interface FlattenResult {
  data: Record<string, Record<string, string>>;
  displayNames: Record<string, string>;
}

function flattenYamlEnvironments(
  tree: YamlEnvTree,
  prefix: string | null = null,
  parentVars: Record<string, string> = {}
): FlattenResult {
  const data: Record<string, Record<string, string>> = {};
  const displayNames: Record<string, string> = {};

  for (const [key, node] of Object.entries(tree)) {
    const envName = prefix ? `${prefix}.${key}` : key;
    const currentVars = { ...parentVars, ...(node.variables || {}) };
    // Intermediate environments are used only for grouping/inheritance,
    // they don't appear in the env selector as selectable options
    if (!node.intermediate) {
      data[envName] = currentVars;
      if (node.displayName) {
        displayNames[envName] = node.displayName;
      }
    }

    if (node.children) {
      const childResult = flattenYamlEnvironments(node.children, envName, currentVars);
      Object.assign(data, childResult.data);
      Object.assign(displayNames, childResult.displayNames);
    }
  }

  return { data, displayNames };
}

const VOIDEN_DIR = ".voiden";

/**
 * Return the public/private file paths (relative to project root) for a given profile.
 * All env YAML files live inside .voiden/.
 * Default profile → .voiden/env-public.yaml / .voiden/env-private.yaml
 * Named profiles  → .voiden/env-{name}-public.yaml / .voiden/env-{name}-private.yaml
 */
function profileFileNames(profile?: string | null): { publicFile: string; privateFile: string } {
  if (!profile || profile === "default") {
    return {
      publicFile: `${VOIDEN_DIR}/env-public.yaml`,
      privateFile: `${VOIDEN_DIR}/env-private.yaml`,
    };
  }
  return {
    publicFile: `${VOIDEN_DIR}/env-${profile}-public.yaml`,
    privateFile: `${VOIDEN_DIR}/env-${profile}-private.yaml`,
  };
}

/**
 * Discover all environment profiles in a project directory.
 * Scans .voiden/ for env-*-public.yaml / env-*-private.yaml files and extracts profile names.
 * Falls back to the project root for backward compatibility with old file locations.
 * Always includes "default".
 */
async function discoverProfiles(projectPath: string): Promise<string[]> {
  const profiles = new Set<string>(["default"]);
  const scanDir = async (dir: string) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const match = entry.name.match(/^env-([a-z0-9-]+)-(public|private)\.yaml$/);
        if (match) profiles.add(match[1]);
      }
    } catch { /* not readable */ }
  };
  await scanDir(path.join(projectPath, VOIDEN_DIR));
  // Legacy fallback: also scan project root so old files are discoverable
  await scanDir(projectPath);
  return Array.from(profiles);
}

/**
 * Load and parse a single YAML environment file.
 * Tries the given path first; if not found, falls back to the root-level filename
 * so projects that haven't been migrated yet still load correctly. Reports which
 * of the two paths actually had the data — callers that need to show this file's
 * location (e.g. the env selector) can't just assume the .voiden/ convention.
 */
async function loadYamlEnvironment(projectPath: string, envPath: string): Promise<{ tree: YamlEnvTree; usedPath: string }> {
  const envFilePath = path.join(projectPath, envPath);
  try {
    const content = await fs.readFile(envFilePath, 'utf8');
    return { tree: (YAML.parse(content) as YamlEnvTree) || {}, usedPath: envPath };
  } catch (e: any) {
    if (e.code !== 'ENOENT') return { tree: {}, usedPath: envPath };
    // Migration: try the old root-level location (e.g. "env-public.yaml" at project root)
    const rootRelPath = path.basename(envPath);
    const rootFallback = path.join(projectPath, rootRelPath);
    if (rootFallback === envFilePath) return { tree: {}, usedPath: envPath };
    try {
      const content = await fs.readFile(rootFallback, 'utf8');
      return { tree: (YAML.parse(content) as YamlEnvTree) || {}, usedPath: rootRelPath };
    } catch {
      return { tree: {}, usedPath: envPath };
    }
  }
}

/**
 * Load and parse environment files for a given profile.
 * Returns a merged tree structure, or null if no files exist. `profileFile` is
 * the public file's actual on-disk location (.voiden/... or, pre-migration,
 * the project root) — representative of where this profile's data lives, for
 * display purposes (public/private always sit next to each other).
 */
async function loadYamlEnvironments(projectPath: string, profile?: string | null): Promise<FlattenResult & { profileFile: string }> {
  const { publicFile, privateFile } = profileFileNames(profile);
  const publicResult = await loadYamlEnvironment(projectPath, publicFile);
  const privateResult = await loadYamlEnvironment(projectPath, privateFile);

  return {
    ...flattenYamlEnvironments(merge({}, publicResult.tree, privateResult.tree)),
    profileFile: publicResult.usedPath,
  };
}

/**
 * Directory names that are never worth walking into while looking for
 * nested .voiden/ folders — dependency trees, build output, VCS internals,
 * etc. Mirrors fileSystem.ts's LAZY_DIRS; kept as its own copy here so this
 * module doesn't need to import the file-tree module just for this list.
 */
const NESTED_SCAN_SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".cache", ".turbo",
  ".svelte-kit", "out", ".output", ".vercel", "__pycache__", ".venv", "venv",
  ".tox", "vendor", "Pods", ".gradle", "target",
]);
const NESTED_SCAN_MAX_DEPTH = 8;
const NESTED_SCAN_MAX_RESULTS = 100;

/**
 * Recursively look for sub-project folders elsewhere in the project tree —
 * a monorepo whose packages were each opened as their own Voiden project at
 * some point. Qualifies as a candidate by having a .voiden/ folder (even an
 * empty one — the marker survives independent of whether it currently holds
 * env YAML) OR by having .void request files directly inside it (the actual
 * "this is a Voiden project" signal, present even before any env config was
 * ever touched). A bare, unmarked folder with a stray .env and neither
 * signal does NOT qualify, on purpose: this used to walk the entire tree
 * looking for any .env-prefixed file anywhere, which let an unrelated .env
 * in some nested app folder get silently merged into every request's
 * variable resolution. The project's own root is excluded — that's handled
 * by the regular single-project code path elsewhere in this file. A .voiden/
 * folder is never recursed into (it can't contain further nested projects).
 * Returns absolute paths; classifying each as YAML vs. .env fallback happens
 * separately, in loadAllNestedEnvironments, since that requires actually
 * attempting to load them (a .voiden/ marker can be empty, and a folder's
 * own YAML can live at its legacy pre-migration root location instead).
 */
async function scanForNestedCandidateDirs(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, depth: number) {
    if (results.length >= NESTED_SCAN_MAX_RESULTS || depth > NESTED_SCAN_MAX_DEPTH) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (dir !== rootDir) {
      const isCandidate = entries.some((e) =>
        (e.isDirectory() && e.name === VOIDEN_DIR) || (e.isFile() && e.name.endsWith(".void"))
      );
      if (isCandidate) results.push(dir);
    }

    const subdirs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === VOIDEN_DIR) continue; // never recurse into a .voiden dir
      if (entry.name.startsWith(".")) continue; // matches file-tree visibility rule
      if (NESTED_SCAN_SKIP_DIRS.has(entry.name)) continue;
      subdirs.push(entry.name);
    }

    await Promise.all(subdirs.map((name) => walk(path.join(dir, name), depth + 1)));
  }

  await walk(rootDir, 0);
  return results;
}

// scanForNestedCandidateDirs is on the hot path (resolveEnvironmentData runs
// once per {{variable}} substitution during a request send), so the actual
// filesystem walk is cached briefly per project rather than re-run on every
// call — a monorepo's sub-project layout doesn't change often enough to
// justify walking the tree on every substitution.
const NESTED_SCAN_TTL_MS = 15000;
const nestedDirsCache = new Map<string, { dirs: string[]; expires: number }>();

async function findNestedCandidateDirs(rootDir: string): Promise<string[]> {
  const cached = nestedDirsCache.get(rootDir);
  const now = Date.now();
  if (cached && cached.expires > now) return cached.dirs;
  const dirs = await scanForNestedCandidateDirs(rootDir);
  nestedDirsCache.set(rootDir, { dirs, expires: now + NESTED_SCAN_TTL_MS });
  return dirs;
}

/**
 * Load every nested sub-project candidate folder's own environments — YAML
 * if it has any (namespaced under its project-relative folder, and, for
 * anything past the "default" profile, the profile name too — a folder can
 * have several profiles, e.g. a not-yet-migrated legacy root-level "root"
 * profile sitting alongside its own .voiden/ default profile, both with
 * identically-named env nodes, so nothing can collide with the active
 * project's own environment keys or with another sub-project's), otherwise
 * its legacy flat .env files as a fallback — exactly the same yaml-wins,
 * .env-is-a-fallback rule the active project's own environments follow,
 * just applied independently per folder. loadProjectEnv's fallback keys are
 * already each file's absolute path, inherently unique, and the existing
 * relativizeToProject in the env selector already renders them relative to
 * the active project root (e.g. "test/.env"), same as it always has for
 * the active project's own un-migrated .env files — no namespacing needed.
 */
async function loadAllNestedEnvironments(
  rootDir: string,
  candidateDirs: string[]
): Promise<FlattenResult & { sourcePaths: Record<string, string>; sourceProfiles: Record<string, string> }> {
  const data: Record<string, Record<string, string>> = {};
  const displayNames: Record<string, string> = {};
  const sourcePaths: Record<string, string> = {};
  const sourceProfiles: Record<string, string> = {};

  for (const nestedDir of candidateDirs) {
    const relFolder = path.relative(rootDir, nestedDir).split(path.sep).join("/");
    const profiles = await discoverProfiles(nestedDir);
    let hadYaml = false;

    for (const profile of profiles) {
      const { data: subData, displayNames: subDisplayNames } = await loadYamlEnvironments(
        nestedDir,
        profile === "default" ? undefined : profile
      );
      if (Object.keys(subData).length === 0) continue;
      hadYaml = true;
      const prefix = profile === "default" ? relFolder : `${relFolder}::${profile}`;
      for (const [envKey, vars] of Object.entries(subData)) {
        const namespacedKey = `${prefix}/${envKey}`;
        data[namespacedKey] = vars;
        const label = subDisplayNames[envKey] || envKey;
        // A folder can have more than one profile (e.g. a legacy root-level
        // profile sitting alongside its own .voiden/ default profile) with
        // identically-named env nodes — disambiguate them in the picker
        // instead of showing two entries that read exactly the same.
        displayNames[namespacedKey] = profile === "default" ? label : `${label} (${profile})`;
        sourcePaths[namespacedKey] = relFolder;
        sourceProfiles[namespacedKey] = profile;
      }
    }

    if (!hadYaml) {
      Object.assign(data, await loadProjectEnv(nestedDir));
    }
  }

  return { data, displayNames, sourcePaths, sourceProfiles };
}

/**
 * Load environment data for a project, resolving YAML environments or falling back to legacy .env files.
 * Shared by env:load, replaceVariablesSecure, and env:getKeys.
 * Nested sub-project environments (see loadAllNestedEnvironments) are merged
 * in afterward regardless of which branch produced the base result, so a
 * monorepo's not-yet-migrated root .env files keep working exactly as
 * before even when a sub-project elsewhere has its own YAML environments.
 */
async function resolveEnvironmentData(
  projectPath: string,
  activeProfile: string | null | undefined,
  activeEnvPath?: string | null
): Promise<FlattenResult & { profileFile?: string; sourcePaths?: Record<string, string>; sourceProfiles?: Record<string, string> }> {
  const yamlResult = await loadYamlEnvironments(projectPath, activeProfile);

  let data: Record<string, Record<string, string>>;
  let displayNames: Record<string, string>;
  // Only set when YAML was actually found — undefined signals to callers
  // (e.g. the env selector) that this came from the legacy .env fallback,
  // same contract as before this function grew nested-source support.
  let profileFile: string | undefined;

  if (Object.keys(yamlResult.data).length > 0) {
    data = { ...yamlResult.data };
    displayNames = { ...yamlResult.displayNames };
    profileFile = yamlResult.profileFile;
  } else {
    data = await loadProjectEnv(projectPath);
    displayNames = {};
  }

  // Nested sub-project environments (see loadAllNestedEnvironments) —
  // independent of whether the root project itself has YAML or falls back
  // to its own flat .env files; each nested folder resolves the same way
  // the active project does, on its own. A nested folder's legacy .env
  // fallback keys are absolute paths (inherently unique, mixed straight
  // into `data`); its YAML keys are namespaced under sourcePaths/sourceProfiles.
  // Merged in *before* the hierarchy-merge step below so a nested .env's
  // hierarchy resolves too, not just the active project's own.
  const nestedCandidateDirs = await findNestedCandidateDirs(projectPath);
  let sourcePaths: Record<string, string> | undefined;
  let sourceProfiles: Record<string, string> | undefined;
  if (nestedCandidateDirs.length > 0) {
    const nested = await loadAllNestedEnvironments(projectPath, nestedCandidateDirs);
    data = { ...data, ...nested.data };
    displayNames = { ...displayNames, ...nested.displayNames };
    sourcePaths = nested.sourcePaths;
    sourceProfiles = nested.sourceProfiles;
  }

  // Hierarchy merge (".env" + ".env.foo" + ".env.foo.bar" -> combined
  // values) only makes sense for legacy flat-file keys, which are always
  // absolute paths — never for YAML env names (root or namespaced-nested),
  // which use dots/slashes for inheritance already resolved elsewhere and
  // would otherwise get clobbered here (getEnvHierarchy assumes a real file
  // path; run against a YAML key it silently returns nothing, replacing
  // that env's real variables with {}). path.isAbsolute is the guard,
  // since every legacy fallback key — root's own or a nested folder's — is
  // always constructed from an absolute directory, and no YAML key ever is.
  if (activeEnvPath && data[activeEnvPath] && path.isAbsolute(activeEnvPath)) {
    data[activeEnvPath] = getEnvHierarchy(activeEnvPath).reduce((acc, envKey) => {
      return data[envKey] ? { ...acc, ...data[envKey] } : acc;
    }, {} as Record<string, string>);
  }

  return { data, displayNames, profileFile, sourcePaths, sourceProfiles };
}

/**
 * Get the hierarchy of .env files for a given active environment.
 * For example, if activeEnv is "/path/to/project/.env.foo.bar",
 * it returns, in order, ["/path/to/project/.env", "/path/to/project/.env.foo", "/path/to/project/.env.foo.bar"]
 */
function getEnvHierarchy(activeEnvPath: string): string[] {
  const dir = path.dirname(activeEnvPath);
  const parts = path.basename(activeEnvPath).split(".");
  const hierarchy: string[] = [];
  let currentName = "";
  // skipping parts[0], which is empty due to leading dot
  for (let i = 1; i < parts.length; i++) {
    currentName += "." + parts[i];
    hierarchy.push(path.join(dir, currentName));
  }
  return hierarchy.sort((a, b) => a.length - b.length);
}

ipcMain.handle("env:load", async (event:IpcMainInvokeEvent): Promise<EnvLoadResult & { activeProfile: string | null }> => {
  const appState = getAppState(event);
  const activeProject = await getActiveProject(event);
  if (!appState.directories[activeProject]) return { activeEnv: null, activeProfile: null, data: {}, displayNames: {} };
  let activeEnv = appState.directories[activeProject].activeEnv;
  const activeProfile = appState.directories[activeProject].activeProfile || null;
  if (!activeProject) return { activeEnv: null, activeProfile: null, data: {}, displayNames: {} };

  const envs = await resolveEnvironmentData(activeProject, activeProfile, activeEnv);

  if (activeEnv && !envs.data[activeEnv]) {
    activeEnv = null;
  }

  return {
    activeEnv,
    activeProfile,
    data: envs.data,
    displayNames: envs.displayNames,
    profileFile: envs.profileFile,
    sourcePaths: envs.sourcePaths,
    sourceProfiles: envs.sourceProfiles,
  };
});

ipcMain.handle("env:setActive", async (event:IpcMainInvokeEvent, envPath) => {
  const appState = getAppState(event);
  const activeProject = await getActiveProject(event);
  appState.directories[activeProject].activeEnv = envPath;
  await saveState(appState);
});

/**
 * Replace {{VARIABLE}} patterns with values from active environment.
 * This runs in Electron main process - UI never sees the actual values.
 *
 * @security Environment values never leave the main process
 */
export async function replaceVariablesSecure(text: string, projectPath: string): Promise<string> {

  const appState = getAppState();
  const activeEnvPath = appState.directories[projectPath]?.activeEnv;
  const activeProfile = appState.directories[projectPath]?.activeProfile || null;

  // Load environment variables
  let env: Record<string, string> = {};
  if (activeEnvPath) {
    const { data: envData } = await resolveEnvironmentData(projectPath, activeProfile, activeEnvPath);
    if (envData[activeEnvPath]) {
      env = envData[activeEnvPath];
    }
  }

  // Load process/runtime variables from .voiden/.process.env.json (env-scoped)
  let processVars: Record<string, any> = {};
  try {
    const processEnvPath = path.join(projectPath, '.voiden', '.process.env.json');
    const data = await fs.readFile(processEnvPath, 'utf-8');
    const raw = JSON.parse(data) || {};
    // Detect old flat format (any root value is not a plain object)
    const isOldFlat = Object.values(raw).some(
      (v: any) => typeof v !== 'object' || v === null || Array.isArray(v)
    );
    if (isOldFlat) {
      processVars = raw;
    } else {
      // New env-scoped format: merge __global__ + active env
      const globalVars: Record<string, any> = raw['__global__'] ?? {};
      const envVars: Record<string, any> = activeEnvPath ? (raw[activeEnvPath] ?? {}) : {};
      processVars = { ...globalVars, ...envVars };
    }
  } catch { /* file may not exist */ }

  // Replace {{VAR_NAME}} and {{process.xxx}} patterns
  const result = text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const trimmedVarName = varName.trim();

    // Skip faker variables - they should already be replaced by Stage 5 faker hook
    if (trimmedVarName.startsWith('$faker.')) {
      return match;
    }

    // Handle {{process.xxx}} — resolve from runtime variables
    if (trimmedVarName.startsWith('process.')) {
      const processKey = trimmedVarName.slice('process.'.length).trim();
      const value = processVars[processKey];
      if (value !== undefined && value !== null) {
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
      }
      return match;
    }

    // Handle {{ENV_VAR}} — resolve from environment
    const value = env[trimmedVarName];
    if (value !== undefined) {
      return value;
    }

    return match; // Keep original if not found
  });

  return result;
}

/**
 * Secure IPC handler for variable replacement.
 * UI sends raw text with {{variables}}, receives replaced text.
 * UI never sees the actual environment values.
 */
ipcMain.handle("env:replaceVariables", async (_, text: string) => {
  const activeProject = await getActiveProject();
  if (!activeProject) {
    return text;
  }
  return replaceVariablesSecure(text, activeProject);
});

/**
 * Get keys (names) of environment variables for autocomplete.
 * Returns only metadata, not values.
 *
 * @security Only returns variable names, not values
 */
ipcMain.handle("env:getKeys", async (event:IpcMainInvokeEvent) => {
  const appState = getAppState(event);
  const activeProject = await getActiveProject();

  if (!activeProject) {
    return [];
  }

  const activeEnvPath = appState.directories[activeProject]?.activeEnv;
  const activeProfile = appState.directories[activeProject]?.activeProfile || null;

  if (!activeEnvPath) {
    return [];
  }

  const { data: envData } = await resolveEnvironmentData(activeProject, activeProfile, activeEnvPath);

  if (!envData[activeEnvPath]) {
    return [];
  }

  return Object.keys(envData[activeEnvPath]);
});

ipcMain.handle("env:getYamlTrees", async (event, params?: { profile?: string }) => {
  const activeProject = await getActiveProject(event);
  if (!activeProject) return { public: {}, private: {} };
  const { publicFile, privateFile } = profileFileNames(params?.profile);
  const publicTree = (await loadYamlEnvironment(activeProject, publicFile)).tree;
  const privateTree = (await loadYamlEnvironment(activeProject, privateFile)).tree;
  return { public: publicTree, private: privateTree };
});

/**
 * List every nested sub-project .voiden/ found elsewhere in the active
 * project (see findNestedCandidateDirs), one entry per (folder, profile) —
 * a folder can have more than one profile, e.g. a legacy root-level
 * profile sitting alongside its own .voiden/ default profile — each with
 * its public/private YAML trees already loaded, batched into one call so
 * the Environment Editor doesn't need a query per discovered folder/profile.
 * `relPath` is the project-relative folder only — never the yaml filename.
 */
ipcMain.handle("env:getNestedEnvSources", async (event) => {
  const activeProject = await getActiveProject(event);
  if (!activeProject) return [];
  const nestedDirs = await findNestedCandidateDirs(activeProject);
  const sources = await Promise.all(nestedDirs.map(async (dir) => {
    const relPath = path.relative(activeProject, dir).split(path.sep).join("/");
    const profiles = await discoverProfiles(dir);
    return Promise.all(profiles.map(async (profile) => {
      const { publicFile, privateFile } = profileFileNames(profile === "default" ? undefined : profile);
      const publicTree = (await loadYamlEnvironment(dir, publicFile)).tree;
      const privateTree = (await loadYamlEnvironment(dir, privateFile)).tree;
      return { projectPath: dir, relPath, profile, public: publicTree, private: privateTree };
    }));
  }));
  // Drop profiles with nothing in either tree (e.g. "default" seeded by
  // discoverProfiles even when only a named profile's files actually exist).
  return sources.flat().filter((s) => Object.keys(s.public).length > 0 || Object.keys(s.private).length > 0);
});

/**
 * Write the public/private YAML trees for a profile to disk, creating
 * .voiden/ and the files themselves if they don't exist yet.
 * Shared by env:saveYamlTrees and the env-extend logic below.
 */
async function writeYamlTrees(
  activeProject: string,
  profile: string | null | undefined,
  publicTree: YamlEnvTree,
  privateTree: YamlEnvTree,
) {
  // Ensure .voiden/ directory exists
  const voidenDir = path.join(activeProject, VOIDEN_DIR);
  await fs.mkdir(voidenDir, { recursive: true });

  const { publicFile, privateFile } = profileFileNames(profile);
  const publicPath = path.join(activeProject, publicFile);
  const privatePath = path.join(activeProject, privateFile);

  const yamlSettings: YAML.ToStringOptions = {
    lineWidth: 0,
    defaultStringType: 'QUOTE_DOUBLE',
    defaultKeyType: 'PLAIN',
  };

  await fs.writeFile(publicPath, YAML.stringify(publicTree, yamlSettings), 'utf8');
  await fs.writeFile(privatePath, YAML.stringify(privateTree, yamlSettings), 'utf8');

  // Keep .gitignore up-to-date: private files + process vars must be ignored,
  // public files are intentionally left trackable by git.
  try {
    const { ensureVoidenGitignore } = await import('./git');
    await ensureVoidenGitignore(activeProject);
  } catch { /* git module may not be available in all contexts */ }

  // Migration: remove old root-level YAML files if they existed before the move to .voiden/
  const rootPublic = path.join(activeProject, path.basename(publicFile));
  const rootPrivate = path.join(activeProject, path.basename(privateFile));
  for (const oldPath of [rootPublic, rootPrivate]) {
    if (oldPath !== publicPath && oldPath !== privatePath) {
      fs.unlink(oldPath).catch(() => {});
    }
  }
}

/**
 * Whether `child` is `parent` itself or a filesystem descendant of it.
 */
function isPathWithin(parent: string, child: string): boolean {
  if (path.resolve(parent) === path.resolve(child)) return true;
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

ipcMain.handle("env:saveYamlTrees", async (event, { publicTree, privateTree, profile, projectPath }: { publicTree: YamlEnvTree; privateTree: YamlEnvTree; profile?: string; projectPath?: string }) => {
  const appState = getAppState(event);
  const activeProjectDefault = await getActiveProject(event);
  let activeProject = activeProjectDefault;
  if (projectPath) {
    if (appState.directories[projectPath]) {
      // Another top-level project the user has open elsewhere.
      activeProject = projectPath;
    } else if (activeProjectDefault && isPathWithin(activeProjectDefault, projectPath)) {
      // A nested sub-project's own .voiden/ discovered inside the active
      // monorepo (see findNestedCandidateDirs) — not separately "opened", but
      // still safe to write to since it's inside the active project.
      activeProject = projectPath;
    }
  }
  if (!activeProject) return;

  try {
    await writeYamlTrees(activeProject, profile, publicTree, privateTree);
  } catch (err) {
    console.error('Failed to save environment YAML files:', err);
    throw err;
  }
});

ipcMain.handle("env:getProfiles", async (event) => {
  const activeProject = await getActiveProject(event);
  if (!activeProject) return ["default"];
  return discoverProfiles(activeProject);
});

// Project-relative path of each profile's public YAML file — same
// used-path resolution loadYamlEnvironments() does for the active profile
// (accounting for the pre-migration root-level fallback), just for every
// discovered profile at once. Kept separate from env:getProfiles (which
// other callers, e.g. the Environment Editor, expect to return a plain
// string[]) so this doesn't ripple into unrelated call sites.
ipcMain.handle("env:getProfileFiles", async (event): Promise<Record<string, string>> => {
  const activeProject = await getActiveProject(event);
  if (!activeProject) return {};
  const profileNames = await discoverProfiles(activeProject);
  const entries = await Promise.all(
    profileNames.map(async (profile) => {
      const { publicFile } = profileFileNames(profile);
      const { usedPath } = await loadYamlEnvironment(activeProject, publicFile);
      return [profile, usedPath] as const;
    }),
  );
  return Object.fromEntries(entries);
});

ipcMain.handle("env:setActiveProfile", async (event, profile: string) => {
  const appState = getAppState(event);
  const activeProject = await getActiveProject(event);
  if (!activeProject || !appState.directories[activeProject]) return;
  appState.directories[activeProject].activeProfile = profile === "default" ? undefined : profile;
  await saveState(appState);
});

const PROFILE_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

ipcMain.handle("env:createProfile", async (event, profile: string) => {
  const activeProject = await getActiveProject(event);
  if (!activeProject || !profile || profile === "default") return;
  if (!PROFILE_NAME_REGEX.test(profile)) {
    throw new Error(`Invalid profile name: "${profile}". Must match ${PROFILE_NAME_REGEX}`);
  }
  // Ensure .voiden/ exists before writing
  await fs.mkdir(path.join(activeProject, VOIDEN_DIR), { recursive: true });
  const { publicFile, privateFile } = profileFileNames(profile);
  const publicPath = path.join(activeProject, publicFile);
  const privatePath = path.join(activeProject, privateFile);
  try { await fs.access(publicPath); } catch { await fs.writeFile(publicPath, "", "utf8"); }
  try { await fs.access(privatePath); } catch { await fs.writeFile(privatePath, "", "utf8"); }
  // Keep gitignore up-to-date
  try { const { ensureVoidenGitignore } = await import('./git'); await ensureVoidenGitignore(activeProject); } catch { }
});

ipcMain.handle("env:deleteProfile", async (event, profile: string) => {
  const activeProject = await getActiveProject(event);
  if (!activeProject || !profile || profile === "default") return;
  if (!PROFILE_NAME_REGEX.test(profile)) {
    throw new Error(`Invalid profile name: "${profile}". Must match ${PROFILE_NAME_REGEX}`);
  }
  const { publicFile, privateFile } = profileFileNames(profile);
  const publicPath = path.join(activeProject, publicFile);
  const privatePath = path.join(activeProject, privateFile);
  try { await fs.unlink(publicPath); } catch { /* file may not exist */ }
  try { await fs.unlink(privatePath); } catch { /* file may not exist */ }
  // If deleted profile was active, reset to default
  const appState = getAppState(event);
  if (appState.directories[activeProject]?.activeProfile === profile) {
    appState.directories[activeProject].activeProfile = undefined;
    await saveState(appState);
  }
});

ipcMain.handle("env:renameProfile", async (event, { oldName, newName }: { oldName: string; newName: string }) => {
  const activeProject = await getActiveProject(event);
  if (!activeProject || !oldName || oldName === "default") return;
  if (!PROFILE_NAME_REGEX.test(oldName) || !PROFILE_NAME_REGEX.test(newName)) {
    throw new Error(`Invalid profile name. Must match ${PROFILE_NAME_REGEX}`);
  }
  if (newName === "default") throw new Error('Cannot rename to "default"');
  const { publicFile: oldPublic, privateFile: oldPrivate } = profileFileNames(oldName);
  const { publicFile: newPublic, privateFile: newPrivate } = profileFileNames(newName);
  try { await fs.rename(path.join(activeProject, oldPublic), path.join(activeProject, newPublic)); } catch { /* file may not exist */ }
  try { await fs.rename(path.join(activeProject, oldPrivate), path.join(activeProject, newPrivate)); } catch { /* file may not exist */ }
  // If renamed profile was active, update state
  const appState = getAppState(event);
  if (appState.directories[activeProject]?.activeProfile === oldName) {
    appState.directories[activeProject].activeProfile = newName;
    await saveState(appState);
  }
});

/**
 * Find (or create) the YamlEnvNode at the given dot-separated path within a tree,
 * creating intermediate nodes as needed.
 */
function getOrCreateYamlNode(tree: YamlEnvTree, segments: string[]): YamlEnvNode {
  let level: YamlEnvTree = tree;
  let node: YamlEnvNode = {};
  for (let i = 0; i < segments.length; i++) {
    const key = segments[i];
    if (!level[key]) level[key] = {};
    node = level[key];
    if (i < segments.length - 1) {
      node.children ??= {};
      level = node.children;
    }
  }
  return node;
}

/**
 * Strip characters that aren't safe as a YAML tree key / dot-path segment.
 * Dots are the nesting delimiter for env paths elsewhere in this file, and
 * spaces are stripped so the key stays a clean identifier; the original,
 * unsanitized name is kept as the node's displayName for the UI.
 */
function sanitizeEnvKey(name: string): string {
  return name.replace(/[.\s]+/g, '');
}

/**
 * Extend an environment with new variables, creating the profile's YAML file
 * (and the target environment node within it) if they don't exist yet.
 *
 * Resolution order:
 * - Profile: the project's active profile, falling back to the "default" profile if none is selected.
 * - Env node within that profile:
 *   1. A node named after `envName` (e.g. the imported Postman environment's own
 *      name, sanitized) — created if it doesn't exist yet. Takes priority over
 *      whatever environment happens to be active, since a named import always
 *      targets its own environment.
 *   2. Otherwise, the active environment, if one is selected — extended in place.
 *   3. If neither is available, falls back to a generic "default" node.
 */
ipcMain.handle('env:extend-env-files', async (event, { comment, variables, envName }: { comment: string; variables: Array<{ key: string; value: string }>; envName?: string }) => {
  const appState = getAppState(event);
  const activeProject = await getActiveProject(event);
  if (!activeProject) return [];

  const activeProfile = appState.directories[activeProject]?.activeProfile || null;
  const activeEnvPath = appState.directories[activeProject]?.activeEnv || null;

  const { publicFile, privateFile } = profileFileNames(activeProfile);

  try {
    const publicTree = (await loadYamlEnvironment(activeProject, publicFile)).tree;
    const privateTree = (await loadYamlEnvironment(activeProject, privateFile)).tree;

    const sanitizedEnvName = envName ? sanitizeEnvKey(envName) : '';
    const segments = sanitizedEnvName
      ? [sanitizedEnvName]
      : activeEnvPath
        ? activeEnvPath.split('.').filter(Boolean)
        : ['default'];
    const node = getOrCreateYamlNode(publicTree, segments.length > 0 ? segments : ['default']);
    // Only label freshly created nodes — don't clobber a name the user already set.
    // Prefer the original (unsanitized) envName for readability in the UI.
    if (!node.variables && !node.displayName) {
      node.displayName = sanitizedEnvName ? envName : comment;
    }
    node.variables ??= {};
    for (const variable of variables) {
      node.variables[variable.key] = variable.value;
    }

    await writeYamlTrees(activeProject, activeProfile, publicTree, privateTree);

    return [{
      file: path.relative(activeProject, path.join(activeProject, publicFile)),
      success: true,
    }];
  } catch (error) {
    return [{
      file: publicFile,
      success: false,
      error: String(error),
    }];
  }
});
