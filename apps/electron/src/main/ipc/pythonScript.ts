/**
 * Python Script Executor
 *
 * IPC handler that executes Python scripts via subprocess.
 * Receives script body + vd API data as JSON via stdin,
 * returns modified request/response + logs as JSON via stdout.
 */

import { ipcMain } from "electron";
import { spawn, execFile } from "child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getActiveProject } from "../state";

const PYTHON_TIMEOUT_MS = 10_000;

let cachedPythonPath: string | null = null;

/**
 * Detect available Python binary.
 * Tries python3 first, then python, caches the result.
 */
async function detectPythonPath(): Promise<string | null> {
  if (cachedPythonPath) return cachedPythonPath;

  const candidates = process.platform === "win32"
    ? ["python3", "python"]
    : ["python3", "python"];

  const whichCmd = process.platform === "win32" ? "where" : "which";

  for (const candidate of candidates) {
    try {
      const result = await new Promise<string | null>((resolve) => {
        execFile(whichCmd, [candidate], { timeout: 3000 }, (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve(null);
          } else {
            resolve(candidate);
          }
        });
      });
      if (result) {
        cachedPythonPath = result;
        return result;
      }
    } catch {
      continue;
    }
  }

  return null;
}

interface PythonScriptPayload {
  scriptBody: string;
  pythonWrapper: string;
  request: any;
  response?: any;
  envVars: Record<string, string>;
  variables: Record<string, any>;
}

interface PythonScriptResult {
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
    // Best-effort persistence; renderer will still receive result for fallback handling.
  }
}

export function registerPythonScriptIpcHandler() {
  ipcMain.handle(
    "script:executePython",
    async (_event, payload: PythonScriptPayload): Promise<PythonScriptResult> => {
      const pythonPath = await detectPythonPath();
      if (!pythonPath) {
        return {
          success: false,
          logs: [],
          error:
            "Python not found. Install Python 3 or ensure python3/python is in your PATH.",
          cancelled: false,
          exitCode: -1,
        };
      }

      const baseVariables = await loadProjectVariables();
      const mergedPayload: PythonScriptPayload = {
        ...payload,
        variables: {
          ...baseVariables,
          ...(payload.variables || {}),
        },
      };
      const projectPath = await getActiveProject();
      const pythonWrapper = payload.pythonWrapper?.trim();
      if (!pythonWrapper) {
        return {
          success: false,
          logs: [],
          error: "Python wrapper source missing from renderer payload.",
          cancelled: false,
          exitCode: -1,
        };
      }

      return new Promise<PythonScriptResult>((resolve) => {
        const child = spawn(pythonPath, ["-c", pythonWrapper], {
          timeout: PYTHON_TIMEOUT_MS,
          stdio: ["pipe", "pipe", "pipe"],
          cwd: projectPath || undefined,
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
              error: stderr || `Python exited with code ${code}`,
              cancelled: false,
              exitCode,
            });
            return;
          }
          try {
            // In case python prints multiple lines, parse the last non-empty line as JSON.
            const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
            const jsonLine = lines.length > 0 ? lines[lines.length - 1] : stdout;
            const result = JSON.parse(jsonLine) as PythonScriptResult;
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
              error: `Failed to parse Python output: ${stdout.slice(0, 500)}`,
              cancelled: false,
              exitCode,
            });
          }
        });

        child.on("error", (err) => {
          resolve({
            success: false,
            logs: [],
            error: `Failed to spawn Python: ${err.message}`,
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
