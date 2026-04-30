/**
 * Node.js Script Executor
 *
 * IPC handler that executes JavaScript scripts via Node.js subprocess
 * using worker_threads. The worker host wrapper + workerSource are
 * provided by the renderer scripting engine so main-process execution
 * stays generic and not tied to a single hardcoded wrapper.
 *
 * The outer Node process acts as the RPC host — handling env:get,
 * variables:get, variables:set messages — exactly as the browser
 * renderer does for Web Workers. `require()` is available inside
 * the worker thread so users can import installed npm packages.
 */

import { ipcMain } from "electron";
import { spawn, execFile } from "child_process";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { getActiveProject } from "../state";

const NODE_TIMEOUT_MS = 10_000;

let cachedNodePath: string | null = null;

/**
 * Common Node.js install paths that may not be in Electron's default PATH.
 */
const COMMON_NODE_PATHS = process.platform === "win32"
  ? [
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Program Files (x86)\\nodejs\\node.exe",
    ]
  : [
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/bin/node",
      path.join(process.env.HOME || "~", ".nvm/current/bin/node"),
      path.join(process.env.HOME || "~", ".volta/bin/node"),
      path.join(process.env.HOME || "~", ".fnm/current/bin/node"),
      path.join(process.env.HOME || "~", ".local/bin/node"),
    ];

/**
 * Extended PATH for shell lookups — Electron GUI apps on macOS often
 * launch with a minimal PATH that excludes Homebrew / nvm / volta dirs.
 */
const EXTENDED_PATH = [
  process.env.PATH || "",
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/usr/bin",
  path.join(process.env.HOME || "~", ".nvm/current/bin"),
  path.join(process.env.HOME || "~", ".volta/bin"),
  path.join(process.env.HOME || "~", ".fnm/current/bin"),
].join(path.delimiter);

/**
 * Detect available Node.js binary.
 */
async function detectNodePath(): Promise<string | null> {
  if (cachedNodePath) return cachedNodePath;

  // 1. Try `which`/`where` with an extended PATH
  const whichCmd = process.platform === "win32" ? "where" : "which";
  try {
    const result = await new Promise<string | null>((resolve) => {
      execFile(
        whichCmd,
        ["node"],
        { timeout: 3000, env: { ...process.env, PATH: EXTENDED_PATH } },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve(null);
          } else {
            resolve(stdout.trim().split(/\r?\n/)[0]);
          }
        },
      );
    });
    if (result) {
      cachedNodePath = result;
      return result;
    }
  } catch {
    // Fall through to direct path checks
  }

  // 2. Check common install paths directly
  for (const candidate of COMMON_NODE_PATHS) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      cachedNodePath = candidate;
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

interface NodeScriptPayload {
  scriptBody: string;
  nodeHostWrapper: string;
  workerSource: string;
  request: any;
  response?: any;
  envVars: Record<string, string>;
  variables: Record<string, any>;
}

interface NodeScriptResult {
  success: boolean;
  logs: Array<{ level: string; args: any[] }>;
  error?: string;
  cancelled: boolean;
  exitCode?: number;
  modifiedRequest?: any;
  modifiedResponse?: any;
  modifiedVariables?: Record<string, any>;
}

async function loadProjectVariables(): Promise<Record<string, any>> {
  try {
    const { loadVariablesForActive } = await import("../variables");
    return await loadVariablesForActive();
  } catch {
    return {};
  }
}

async function persistProjectVariables(next: Record<string, any>): Promise<void> {
  try {
    const { mergeWriteVariablesForActive } = await import("../variables");
    await mergeWriteVariablesForActive(next);
  } catch {
    // Best-effort persistence
  }
}

export function registerNodeScriptIpcHandler() {
  ipcMain.handle(
    "script:executeNode",
    async (_event, payload: NodeScriptPayload): Promise<NodeScriptResult> => {
      const nodePath = await detectNodePath();
      if (!nodePath) {
        return {
          success: false,
          logs: [],
          error:
            "Node.js not found. Ensure node is in your PATH.",
          cancelled: false,
          exitCode: -1,
        };
      }

      const projectPath = await getActiveProject();
      const nodeHostWrapper = payload.nodeHostWrapper?.trim();
      if (!nodeHostWrapper) {
        return {
          success: false,
          logs: [],
          error: "Node host wrapper source missing from renderer payload.",
          cancelled: false,
          exitCode: -1,
        };
      }
      const baseVariables = await loadProjectVariables();
      const mergedPayload: NodeScriptPayload = {
        ...payload,
        variables: {
          ...baseVariables,
          ...(payload.variables || {}),
        },
      };

      return new Promise<NodeScriptResult>((resolve) => {
        const child = spawn(nodePath, ["-e", nodeHostWrapper], {
          timeout: NODE_TIMEOUT_MS,
          stdio: ["pipe", "pipe", "pipe"],
          cwd: projectPath || undefined,
          env: { ...process.env, PATH: EXTENDED_PATH },
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        child.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        child.on("close", async (code) => {
          const exitCode = code ?? -1;
          if (code !== 0 && !stdout) {
            resolve({
              success: false,
              logs: [],
              error: stderr || `Node.js exited with code ${code}`,
              cancelled: false,
              exitCode,
            });
            return;
          }
          try {
            const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
            const jsonLine = lines.length > 0 ? lines[lines.length - 1] : stdout;
            const result = JSON.parse(jsonLine) as NodeScriptResult;
            const normalizedExitCode = result.success === false && exitCode === 0 ? 1 : exitCode;
            result.exitCode = normalizedExitCode;

            if (result.modifiedVariables && Object.keys(result.modifiedVariables).length > 0) {
              const current = await loadProjectVariables();
              const merged = { ...current, ...result.modifiedVariables };
              await persistProjectVariables(merged);
            }
            resolve(result);
          } catch {
            resolve({
              success: false,
              logs: [],
              error: `Failed to parse Node.js output: ${stdout.slice(0, 500)}`,
              cancelled: false,
              exitCode,
            });
          }
        });

        child.on("error", (err) => {
          resolve({
            success: false,
            logs: [],
            error: `Failed to spawn Node.js: ${err.message}`,
            cancelled: false,
            exitCode: -1,
          });
        });

        child.stdin.write(JSON.stringify(mergedPayload));
        child.stdin.end();
      });
    }
  );
}
