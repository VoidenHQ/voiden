import path from "node:path";
import fs from "node:fs/promises";

/**
 * Merge .env files from the project root to the request's directory.
 * @param projectPath Workspace root.
 * @param requestFilePath Absolute path to a saved request.
 * @param selectedEnv Currently selected environment; overrides root values.
 * @returns Resolved values, with the closest folder taking precedence.
 * @example await loadFolderEnv(projectRoot, requestPath, activeEnvironment)
 */
export async function loadFolderEnv(projectPath: string, requestFilePath: string, selectedEnv: Record<string, string> = {}): Promise<Record<string, string>> {
  if (!path.isAbsolute(requestFilePath)) return selectedEnv;

  let projectRoot: string;
  let requestFile: string;
  try {
    projectRoot = await fs.realpath(projectPath);
    requestFile = await fs.realpath(requestFilePath);
  } catch {
    return selectedEnv;
  }

  const requestDir = path.dirname(requestFile);
  const relativeDir = path.relative(projectRoot, requestDir);
  if (relativeDir === ".." || relativeDir.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDir)) {
    return selectedEnv;
  }

  const directories = [projectRoot];
  if (relativeDir) {
    let current = projectRoot;
    for (const segment of relativeDir.split(path.sep)) {
      current = path.join(current, segment);
      directories.push(current);
    }
  }

  const variables: Record<string, string> = {};
  for (const [index, directory] of directories.entries()) {
    // The selected environment overrides the root .env. More specific
    // folder .env files then override both.
    if (index === 1) {
      Object.assign(variables, selectedEnv);
    }
    try {
      const envFile = path.join(directory, ".env");
      // Avoid following a .env symlink into an unrelated directory.
      if (!(await fs.lstat(envFile)).isFile()) continue;
      Object.assign(variables, parseEnvContent(await fs.readFile(envFile, "utf8")));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
  if (directories.length === 1) Object.assign(variables, selectedEnv);
  return variables;
}

/**
 * Parse a legacy dotenv file using the same rules as the environment selector.
 * @param content File content.
 * @returns Variable names and values.
 * @example parseEnvContent("HOST=localhost")
 */
export function parseEnvContent(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  content.split(/\r?\n/).forEach((line) => {
    line = line.trim();
    if (!line || line.startsWith("#")) return;
    const eqIndex = line.indexOf("=");
    if (eqIndex < 0) return;
    const key = line.substring(0, eqIndex).trim();
    let value = line.substring(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.substring(1, value.length - 1);
    }
    env[key] = value;
  });
  return env;
}
