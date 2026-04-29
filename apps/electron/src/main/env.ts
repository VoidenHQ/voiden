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
 * Recursively search for files starting with ".env" in the given directory.
 * Returns an array of absolute file paths.
 */
async function findEnvFilesRecursively(dir: string) {
  let envFiles: string[] = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    return envFiles;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Recursively search in subdirectory
      const subDirEnvFiles = await findEnvFilesRecursively(fullPath);
      envFiles = envFiles.concat(subDirEnvFiles);
    } else if (entry.isFile() && entry.name.startsWith(".env")) {
      envFiles.push(fullPath);
    }
  }

  return envFiles;
}

/**
 * Load all .env files (including nested ones) in the given project path and combine their content.
 * If there are duplicate keys, later files in the array will override earlier ones.
 */
async function loadProjectEnv(projectPath: string) {
  const envData: Record<string, Record<string, string>> = {};

  // Recursively find .env files starting from the projectPath.
  const envFiles = await findEnvFilesRecursively(projectPath);

  // Optionally sort the file paths to ensure a consistent order.
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
 * so projects that haven't been migrated yet still load correctly.
 */
async function loadYamlEnvironment(projectPath: string, envPath: string): Promise<YamlEnvTree> {
  const envFilePath = path.join(projectPath, envPath);
  try {
    const content = await fs.readFile(envFilePath, 'utf8');
    return (YAML.parse(content) as YamlEnvTree) || {};
  } catch (e: any) {
    if (e.code !== 'ENOENT') return {};
    // Migration: try the old root-level location (e.g. "env-public.yaml" at project root)
    const rootFallback = path.join(projectPath, path.basename(envPath));
    if (rootFallback === envFilePath) return {};
    try {
      const content = await fs.readFile(rootFallback, 'utf8');
      return (YAML.parse(content) as YamlEnvTree) || {};
    } catch {
      return {};
    }
  }
}

/**
 * Load and parse environment files for a given profile.
 * Returns a merged tree structure, or null if no files exist.
 */
async function loadYamlEnvironments(projectPath: string, profile?: string | null): Promise<FlattenResult> {
  const { publicFile, privateFile } = profileFileNames(profile);
  const publicTree = loadYamlEnvironment(projectPath, publicFile);
  const privateTree = loadYamlEnvironment(projectPath, privateFile);

  // Merge and return
  return flattenYamlEnvironments(merge({}, await publicTree, await privateTree));
}

/**
 * Load environment data for a project, resolving YAML environments or falling back to legacy .env files.
 * Shared by env:load, replaceVariablesSecure, and env:getKeys.
 */
async function resolveEnvironmentData(
  projectPath: string,
  activeProfile: string | null | undefined,
  activeEnvPath?: string | null
): Promise<FlattenResult> {
  const yamlResult = await loadYamlEnvironments(projectPath, activeProfile);
  if (Object.keys(yamlResult.data).length > 0) {
    return yamlResult;
  }
  const envFiles = await loadProjectEnv(projectPath);
  if (activeEnvPath && envFiles[activeEnvPath]) {
    envFiles[activeEnvPath] = getEnvHierarchy(activeEnvPath).reduce((acc, envKey) => {
      return envFiles[envKey] ? { ...acc, ...envFiles[envKey] } : acc;
    }, {} as Record<string, string>);
  }
  return { data: envFiles, displayNames: {} };
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
  const publicTree = await loadYamlEnvironment(activeProject, publicFile);
  const privateTree = await loadYamlEnvironment(activeProject, privateFile);
  return { public: publicTree, private: privateTree };
});

ipcMain.handle("env:saveYamlTrees", async (event, { publicTree, privateTree, profile }: { publicTree: YamlEnvTree; privateTree: YamlEnvTree; profile?: string }) => {
  const activeProject = await getActiveProject(event);
  if (!activeProject) return;

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

  try {
    await fs.writeFile(publicPath, YAML.stringify(publicTree, yamlSettings), 'utf8');
    await fs.writeFile(privatePath, YAML.stringify(privateTree, yamlSettings), 'utf8');
  } catch (err) {
    console.error('Failed to save environment YAML files:', err);
    throw err;
  }

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
});

ipcMain.handle("env:getProfiles", async (event) => {
  const activeProject = await getActiveProject(event);
  if (!activeProject) return ["default"];
  return discoverProfiles(activeProject);
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

// Simple handler to extend all .env files
ipcMain.handle('env:extend-env-files', async (event, { comment, variables }) => {
  const activeProject = await getActiveProject(event);
  const envFiles = await findEnvFilesRecursively(activeProject);

  const results = [];
  for (const filePath of envFiles) {
    try {
      await extendEnvFile(filePath, comment, variables);
      results.push({
        file: path.relative(process.cwd(), filePath),
        success: true
      });
    } catch (error) {
      results.push({
        file: path.relative(process.cwd(), filePath),
        success: false,
        error: String(error),
      });
    }
  }
  return results;
});

// Function to extend a single .env file
async function extendEnvFile(filePath: string, comment: string, variables: Array<{key: string, value: string}>) {
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    console.log('File does not exist');
    return;
  }
  if (content && !content.endsWith('\n')) {
    content += '\n';
  }

  content += `\n# ${comment}\n`;
  for (const variable of variables) {
    content += `${variable.key}=${variable.value}\n`;
  }
  await fs.writeFile(filePath, content, 'utf8');
}
