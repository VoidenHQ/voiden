import path from "path";
import { getActiveProject, getAppState } from "./state";
import fs from "node:fs/promises";
import { ipcMain, IpcMainInvokeEvent } from "electron";
import { saveState } from "./persistState";
import merge from "lodash/merge";
import yaml from "js-yaml";
import YAML from "yaml";

/**
 * Type definitions for YAML environment system
 */
interface YamlEnvNode {
  variables?: Record<string, string>;
  children?: Record<string, YamlEnvNode>;
}

interface YamlEnvTree {
  [key: string]: YamlEnvNode;
}

interface EnvLoadResult {
  activeEnv: string | null;
  data: Record<string, Record<string, string>>;
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
    // console.error(`Unable to read directory ${dir}:`, err);
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
      // console.error(`Unable to read ${filePath}:`, err);
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
function flattenYamlEnvironments(
  tree: YamlEnvTree,
  prefix: string | null = null,
  parentVars: Record<string, string> = {}
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};

  for (const [key, node] of Object.entries(tree)) {
    const envName = prefix ? `${prefix}.${key}` : key;
    const currentVars = { ...parentVars, ...(node.variables || {}) };
    result[envName] = currentVars;

    if (node.children) {
      const childEnvs = flattenYamlEnvironments(node.children, envName, currentVars);
      Object.assign(result, childEnvs);
    }
  }

  return result;
}

/**
 * Return the public/private filenames for a given profile.
 * Default profile (undefined/null/"default") uses env-public.yaml / env-private.yaml.
 * Named profiles use env-{name}-public.yaml / env-{name}-private.yaml.
 */
function profileFileNames(profile?: string | null): { publicFile: string; privateFile: string } {
  if (!profile || profile === "default") {
    return { publicFile: "env-public.yaml", privateFile: "env-private.yaml" };
  }
  return {
    publicFile: `env-${profile}-public.yaml`,
    privateFile: `env-${profile}-private.yaml`,
  };
}

/**
 * Discover all environment profiles in a project directory.
 * Scans for env-*-public.yaml / env-*-private.yaml files and extracts profile names.
 * Always includes "default".
 */
async function discoverProfiles(projectPath: string): Promise<string[]> {
  const profiles = new Set<string>(["default"]);
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      // Match env-{name}-public.yaml or env-{name}-private.yaml
      const match = entry.name.match(/^env-([a-z0-9-]+)-(public|private)\.yaml$/);
      if (match) {
        profiles.add(match[1]);
      }
    }
  } catch {
    // Directory not readable, return just default
  }
  return Array.from(profiles);
}

/**
 * Load and parse a single YAML environment file.
 * @return empty object if the file doesn't exist or is invalid
 */
async function loadYamlEnvironment(projectPath: string, envPath: string): Promise<YamlEnvTree> {
  const envFilePath = path.join(projectPath, envPath);
  try {
    const content = await fs.readFile(envFilePath, 'utf8');
    return (yaml.load(content) as YamlEnvTree) || {};
  } catch {
    return {};
  }
}

/**
 * Load and parse environment files for a given profile.
 * Returns a merged tree structure, or null if no files exist.
 */
async function loadYamlEnvironments(projectPath: string, profile?: string | null): Promise<Record<string, Record<string, string>>> {
  const { publicFile, privateFile } = profileFileNames(profile);
  const publicTree = loadYamlEnvironment(projectPath, publicFile);
  const privateTree = loadYamlEnvironment(projectPath, privateFile);

  // Merge and return
  return flattenYamlEnvironments(merge({}, await publicTree, await privateTree));
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
  if (!appState.directories[activeProject]) return { activeEnv: null, activeProfile: null, data: {} };
  let activeEnv = appState.directories[activeProject].activeEnv;
  const activeProfile = appState.directories[activeProject].activeProfile || null;
  if (!activeProject) return { activeEnv: null, activeProfile: null, data: {} };

  const yamlEnvs = loadYamlEnvironments(activeProject, activeProfile);
  const envFiles = await loadProjectEnv(activeProject);
  const envs = { ... envFiles, ... await yamlEnvs };

  if (activeEnv && !envs[activeEnv]) {
    activeEnv = null;
  }

  if (activeEnv && envFiles[activeEnv]) {
    envs[activeEnv] = getEnvHierarchy(activeEnv).reduce((acc, envKey) => {
      return envs[envKey] ? { ...acc, ...envs[envKey] } : acc;
    }, {} as Record<string, string>);
  }

  return {
    activeEnv,
    activeProfile,
    data: envs,
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

  if (!activeEnvPath) {
    return text;
  }

  const yamlEnvs = loadYamlEnvironments(projectPath, activeProfile);
  const envFiles = await loadProjectEnv(projectPath);
  const envData = { ... envFiles, ... await yamlEnvs };

  if (!envData[activeEnvPath]) {
    return text;
  }

  let env = envData[activeEnvPath];

  if (activeEnvPath && envFiles[activeEnvPath]) {
    env = getEnvHierarchy(activeEnvPath).reduce((acc, envKey) => {
      return envData[envKey] ? { ...acc, ...envData[envKey] } : acc;
    }, {} as Record<string, string>);
  }

  // Replace {{VAR_NAME}} patterns
  const result = text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const trimmedVarName = varName.trim();

    // Skip faker variables - they should already be replaced by Stage 5 faker hook
    // This is a defensive check in case the order changes
    if (trimmedVarName.startsWith('$faker.')) {
      return match;
    }

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
    // console.error("[env:replaceVariables] No active project");
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

  const yamlEnvs = loadYamlEnvironments(activeProject, activeProfile);
  const envFiles = await loadProjectEnv(activeProject);
  const envData = { ... envFiles, ... await yamlEnvs };

  if (!envData[activeEnvPath]) {
    return [];
  }

  if (envFiles[activeEnvPath]) {
    const keys = getEnvHierarchy(activeEnvPath)
        .flatMap(envPath => envData[envPath] ? Object.keys(envData[envPath]) : []);
    return Array.from(new Set(keys));
  } else {
    return Object.keys(envData[activeEnvPath]);
  }
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
  const { publicFile, privateFile } = profileFileNames(profile);
  const publicPath = path.join(activeProject, publicFile);
  const privatePath = path.join(activeProject, privateFile);
  const yamlSettings: YAML.ToStringOptions = {
    lineWidth: 0, // Don't wrap lines
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

ipcMain.handle("env:createProfile", async (event, profile: string) => {
  const activeProject = await getActiveProject(event);
  if (!activeProject || !profile || profile === "default") return;
  const { publicFile, privateFile } = profileFileNames(profile);
  const publicPath = path.join(activeProject, publicFile);
  const privatePath = path.join(activeProject, privateFile);
  // Create empty YAML files if they don't exist
  try { await fs.access(publicPath); } catch { await fs.writeFile(publicPath, "", "utf8"); }
  try { await fs.access(privatePath); } catch { await fs.writeFile(privatePath, "", "utf8"); }
});

ipcMain.handle("env:deleteProfile", async (event, profile: string) => {
  const activeProject = await getActiveProject(event);
  if (!activeProject || !profile || profile === "default") return;
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
  try {
    // Use your existing function to find all .env files
    const activeProject = await getActiveProject(event);
    const envFiles = await findEnvFilesRecursively(activeProject);

    const results = [];
    // Process each .env file
    for (const filePath of envFiles) {
      try {
        await extendEnvFile(filePath, comment, variables);
        results.push({
          file: path.relative(process.cwd(), filePath),
          success: true
        });
      } catch (error) {
        console.log(error)
      }
    }
  } catch (error) {
    console.log(error)
  }
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
