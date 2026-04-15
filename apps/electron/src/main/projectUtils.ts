import { app } from "electron";
import fs from "fs/promises";
import path from "path";

export function getSampleProjectTemplateDir() {
  if (!app.isPackaged) {
    return path.resolve(__dirname, "../../src/sample-project");
  }

  return path.join(process.resourcesPath, "sample-project");
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
