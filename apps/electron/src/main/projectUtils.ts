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

export async function ensureVoidenProjectMetadata(
  projectPath: string,
  projectName?: string,
) {
  await fs.mkdir(projectPath, { recursive: true });

  const metadataDir = path.join(projectPath, ".voiden");
  await fs.mkdir(metadataDir, { recursive: true });

  const metadataFile = path.join(metadataDir, ".voiden-projects");
  await fs.writeFile(
    metadataFile,
    JSON.stringify({ project: projectName || path.basename(projectPath) }),
    "utf8",
  );
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
