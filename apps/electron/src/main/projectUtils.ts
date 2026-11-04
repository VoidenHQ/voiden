import { app } from "electron";
import fs from "fs/promises";
import path from "path";

export function getSampleProjectTemplateDir() {
  if (!app.isPackaged) {
    return path.resolve(__dirname, "../../src/sample-project");
  }

  return path.join(process.resourcesPath, "sample-project");
}

export function getPlaygroundProjectTemplateDir() {
  if (!app.isPackaged) {
    return path.resolve(__dirname, "../../src/playground-project");
  }

  return path.join(process.resourcesPath, "playground-project");
}

export async function copyDirectory(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
      continue;
    }

    await fs.copyFile(srcPath, destPath);
  }
}

export type ProjectMetadata = {
  project: string;
  locked?: boolean;
};

function getMetadataFile(projectPath: string) {
  return path.join(projectPath, ".voiden", ".voiden-projects");
}

export async function readProjectMetadata(
  projectPath: string,
): Promise<ProjectMetadata | null> {
  try {
    const raw = await fs.readFile(getMetadataFile(projectPath), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.project === "string") {
      return parsed as ProjectMetadata;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeProjectMetadata(
  projectPath: string,
  metadata: ProjectMetadata,
) {
  const metadataDir = path.join(projectPath, ".voiden");
  await fs.mkdir(metadataDir, { recursive: true });
  await fs.writeFile(
    getMetadataFile(projectPath),
    JSON.stringify(metadata),
    "utf8",
  );
}

export async function ensureVoidenProjectMetadata(
  projectPath: string,
  projectName?: string,
) {
  await fs.mkdir(projectPath, { recursive: true });

  const existing = await readProjectMetadata(projectPath);
  const next: ProjectMetadata = {
    project: existing?.project || projectName || path.basename(projectPath),
    ...(existing?.locked ? { locked: true } : {}),
  };

  await writeProjectMetadata(projectPath, next);
}

export async function getProjectLocked(projectPath: string): Promise<boolean> {
  const metadata = await readProjectMetadata(projectPath);
  return !!metadata?.locked;
}

export async function setProjectLocked(
  projectPath: string,
  locked: boolean,
): Promise<boolean> {
  const existing = await readProjectMetadata(projectPath);
  const next: ProjectMetadata = {
    project: existing?.project || path.basename(projectPath),
  };
  if (locked) next.locked = true;
  await writeProjectMetadata(projectPath, next);
  return locked;
}

export async function getUniqueProjectPath(
  baseDirectory: string,
  preferredName: string,
) {
  let finalName = preferredName;
  let counter = 1;

  await fs.mkdir(baseDirectory, { recursive: true });

  while (await pathExists(path.join(baseDirectory, finalName))) {
    finalName = `${preferredName}-${counter}`;
    counter++;
  }

  return path.join(baseDirectory, finalName);
}

export async function createSampleProject(
  baseDirectory: string,
  preferredName = "sample",
) {
  const projectPath = await getUniqueProjectPath(baseDirectory, preferredName);

  await copyDirectory(getSampleProjectTemplateDir(), projectPath);
  await ensureVoidenProjectMetadata(projectPath, path.basename(projectPath));

  return {
    projectPath,
    welcomeFile: path.join(projectPath, "hello.void"),
  };
}

/** The first-run tour project the Start tab opens: five numbered .void files plus Local/Staging environments. */
export async function createPlaygroundProject(baseDirectory: string) {
  const projectPath = await getUniqueProjectPath(baseDirectory, "playground");

  await copyDirectory(getPlaygroundProjectTemplateDir(), projectPath);
  await ensureVoidenProjectMetadata(projectPath, path.basename(projectPath));

  return {
    projectPath,
    welcomeFile: path.join(projectPath, "1-first-request.void"),
  };
}

export async function createEmptyProject(
  baseDirectory: string,
  preferredName: string,
) {
  const projectPath = await getUniqueProjectPath(baseDirectory, preferredName);

  await ensureVoidenProjectMetadata(projectPath, path.basename(projectPath));

  return {
    projectPath,
    welcomeFile: null,
  };
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const SETUP_SCAN_SKIP_DIRS = new Set([
  "node_modules", ".git", ".voiden", "dist", "build", ".next", ".nuxt", ".cache", ".turbo",
  ".svelte-kit", "out", ".output", ".vercel", "__pycache__", ".venv", "venv", ".tox",
  "vendor", "Pods", ".gradle", "target", "coverage",
]);
const SETUP_SCAN_MAX_DEPTH = 6;
const SETUP_SCAN_MAX_FILES = 20000;
const SPEC_MARKER = /^\s*["']?(openapi|swagger)["']?\s*:\s*["']?[23]\./m;
const ENV_TEMPLATE = /^\.env(\.(example|sample|template|dist|defaults))?$/i;

/**
 * Look through a freshly opened folder for things the Start tab's setup screen can
 * offer to turn into Voiden files: OpenAPI/Swagger specs and .env templates.
 * Also counts existing .void files, so the screen is skipped for real Voiden projects.
 */
export async function scanProjectForSetup(projectPath: string) {
  const specs: string[] = [];
  const envFiles: string[] = [];
  let voidCount = 0;
  let seen = 0;

  async function walk(dir: string, depth: number) {
    if (depth > SETUP_SCAN_MAX_DEPTH || seen > SETUP_SCAN_MAX_FILES) return;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++seen > SETUP_SCAN_MAX_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SETUP_SCAN_SKIP_DIRS.has(entry.name)) await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".void")) voidCount++;
      else if (ENV_TEMPLATE.test(entry.name) && entry.name !== ".env") envFiles.push(full);
      else if (/\.(ya?ml|json)$/.test(lower) && specs.length < 20) {
        try {
          const handle = await fs.open(full, "r");
          const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
          await handle.close();
          if (SPEC_MARKER.test(buffer.subarray(0, bytesRead).toString("utf8"))) specs.push(full);
        } catch {
          /* unreadable — skip */
        }
      }
    }
  }

  await walk(projectPath, 0);
  return { voidCount, specs, envFiles };
}
