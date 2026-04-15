/**
 * Voiden Scripting — Main-Process Extension
 *
 * Registers three script-runner IPC handlers inside the plugin itself,
 * exposed as plugin IPC so any other plugin can invoke them:
 *
 *   ext:voiden-scripting:script:executeNode   — Node.js (worker_threads)
 *   ext:voiden-scripting:script:executePython — Python subprocess
 *   ext:voiden-scripting:script:executeShell  — Bash subprocess (macOS/Linux)
 *
 * All runners share the same result shape and persist modified variables to
 * .voiden/.process.env.json in the active project directory.
 */

import type { ElectronExtensionContext, ElectronPlugin } from "@voiden/sdk/electron";
import { spawn, execFile } from "child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── Constants ────────────────────────────────────────────────────────────────

const SCRIPT_TIMEOUT_MS = 10_000;

/**
 * Extended PATH so Electron GUI apps on macOS/Linux find Homebrew / nvm / volta
 * binaries that are absent from the default minimal launch environment.
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

const COMMON_NODE_PATHS =
  process.platform === "win32"
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

// ─── Binary detection (cached) ────────────────────────────────────────────────

let cachedNodePath: string | null = null;
let cachedPythonPath: string | null = null;

async function detectNodePath(): Promise<string | null> {
  if (cachedNodePath) return cachedNodePath;

  const whichCmd = process.platform === "win32" ? "where" : "which";
  try {
    const result = await new Promise<string | null>((resolve) => {
      execFile(
        whichCmd,
        ["node"],
        { timeout: 3000, env: { ...process.env, PATH: EXTENDED_PATH } },
        (error, stdout) => {
          resolve(error || !stdout.trim() ? null : stdout.trim().split(/\r?\n/)[0]);
        },
      );
    });
    if (result) { cachedNodePath = result; return result; }
  } catch { /* fall through */ }

  for (const candidate of COMMON_NODE_PATHS) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      cachedNodePath = candidate;
      return candidate;
    } catch { continue; }
  }
  return null;
}

async function detectPythonPath(): Promise<string | null> {
  if (cachedPythonPath) return cachedPythonPath;

  const whichCmd = process.platform === "win32" ? "where" : "which";
  for (const candidate of ["python3", "python"]) {
    try {
      const result = await new Promise<string | null>((resolve) => {
        execFile(whichCmd, [candidate], { timeout: 3000 }, (error, stdout) => {
          resolve(error || !stdout.trim() ? null : candidate);
        });
      });
      if (result) { cachedPythonPath = result; return result; }
    } catch { continue; }
  }
  return null;
}

// ─── Variable persistence ─────────────────────────────────────────────────────

async function loadProjectVariables(projectPath: string | null | undefined): Promise<Record<string, any>> {
  if (!projectPath) return {};
  try {
    const content = await fs.readFile(
      path.join(projectPath, ".voiden", ".process.env.json"),
      "utf-8",
    );
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

async function persistProjectVariables(
  projectPath: string | null | undefined,
  next: Record<string, any>,
): Promise<void> {
  if (!projectPath) return;
  try {
    const dir = path.join(projectPath, ".voiden");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, ".process.env.json"),
      JSON.stringify(next, null, 2),
      "utf-8",
    );
  } catch { /* best-effort */ }
}

// ─── Shell helpers ────────────────────────────────────────────────────────────

function readTsvB64(file: string): string[][] {
  try {
    return fsSync
      .readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) =>
        l.split("\t").map((col) => {
          try { return Buffer.from(col.trim(), "base64").toString("utf-8"); }
          catch { return col.trim(); }
        }),
      );
  } catch { return []; }
}

function safeJson(val: string, fallback: any): any {
  try { return JSON.parse(val); } catch { return fallback; }
}

// ─── Shared result types ──────────────────────────────────────────────────────

interface ScriptResult {
  success: boolean;
  logs: Array<{ level: string; args: any[] }>;
  error?: string;
  cancelled: boolean;
  exitCode?: number;
  assertions?: any[];
  modifiedRequest?: any;
  modifiedResponse?: any;
  modifiedVariables?: Record<string, any>;
}

// ─── Plugin factory ───────────────────────────────────────────────────────────

export default function createVoidenScriptingMainPlugin(
  ctx: ElectronExtensionContext,
): ElectronPlugin {
  return {
    async onload() {

      // ── Node.js script runner ─────────────────────────────────────────────
      // Exposed as: ext:voiden-scripting:script:executeNode
      ctx.ipc.handle(
        "script:executeNode",
        async (event: any, payload: any): Promise<ScriptResult> => {
          const nodePath = await detectNodePath();
          if (!nodePath) {
            return {
              success: false, logs: [],
              error: "Node.js not found. Ensure node is in your PATH.",
              cancelled: false, exitCode: -1,
            };
          }

          const nodeHostWrapper = payload.nodeHostWrapper?.trim();
          if (!nodeHostWrapper) {
            return {
              success: false, logs: [],
              error: "Node host wrapper source missing from payload.",
              cancelled: false, exitCode: -1,
            };
          }

          const projectPath = await ctx.project.getActive(event);
          const baseVariables = await loadProjectVariables(projectPath);
          const mergedPayload = {
            ...payload,
            variables: { ...baseVariables, ...(payload.variables || {}) },
          };

          return new Promise<ScriptResult>((resolve) => {
            const child = spawn(nodePath, ["-e", nodeHostWrapper], {
              timeout: SCRIPT_TIMEOUT_MS,
              stdio: ["pipe", "pipe", "pipe"],
              cwd: projectPath || undefined,
              env: { ...process.env, PATH: EXTENDED_PATH },
            });

            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
            child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

            child.on("close", async (code) => {
              const exitCode = code ?? -1;
              if (code !== 0 && !stdout) {
                resolve({
                  success: false, logs: [],
                  error: stderr || `Node.js exited with code ${code}`,
                  cancelled: false, exitCode,
                });
                return;
              }
              try {
                const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
                const result = JSON.parse(lines[lines.length - 1] || stdout) as ScriptResult;
                result.exitCode = result.success === false && exitCode === 0 ? 1 : exitCode;
                if (result.modifiedVariables && Object.keys(result.modifiedVariables).length > 0) {
                  const current = await loadProjectVariables(projectPath);
                  await persistProjectVariables(projectPath, { ...current, ...result.modifiedVariables });
                }
                resolve(result);
              } catch {
                resolve({
                  success: false, logs: [],
                  error: `Failed to parse Node.js output: ${stdout.slice(0, 500)}`,
                  cancelled: false, exitCode,
                });
              }
            });

            child.on("error", (err) => {
              resolve({
                success: false, logs: [],
                error: `Failed to spawn Node.js: ${err.message}`,
                cancelled: false, exitCode: -1,
              });
            });

            child.stdin.write(JSON.stringify(mergedPayload));
            child.stdin.end();
          });
        },
      );

      // ── Python script runner ──────────────────────────────────────────────
      // Exposed as: ext:voiden-scripting:script:executePython
      ctx.ipc.handle(
        "script:executePython",
        async (event: any, payload: any): Promise<ScriptResult> => {
          const pythonPath = await detectPythonPath();
          if (!pythonPath) {
            return {
              success: false, logs: [],
              error: "Python not found. Install Python 3 or ensure python3/python is in your PATH.",
              cancelled: false, exitCode: -1,
            };
          }

          const pythonWrapper = payload.pythonWrapper?.trim();
          if (!pythonWrapper) {
            return {
              success: false, logs: [],
              error: "Python wrapper source missing from payload.",
              cancelled: false, exitCode: -1,
            };
          }

          const projectPath = await ctx.project.getActive(event);
          const baseVariables = await loadProjectVariables(projectPath);
          const mergedPayload = {
            ...payload,
            variables: { ...baseVariables, ...(payload.variables || {}) },
          };

          return new Promise<ScriptResult>((resolve) => {
            const child = spawn(pythonPath, ["-c", pythonWrapper], {
              timeout: SCRIPT_TIMEOUT_MS,
              stdio: ["pipe", "pipe", "pipe"],
              cwd: projectPath || undefined,
            });

            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
            child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

            child.on("close", async (code) => {
              const exitCode = code ?? -1;
              if (code !== 0 && !stdout) {
                resolve({
                  success: false, logs: [],
                  error: stderr || `Python exited with code ${code}`,
                  cancelled: false, exitCode,
                });
                return;
              }
              try {
                const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
                const result = JSON.parse(lines[lines.length - 1] || stdout) as ScriptResult;
                result.exitCode = result.success === false && exitCode === 0 ? 1 : exitCode;
                if (result.modifiedVariables && Object.keys(result.modifiedVariables).length > 0) {
                  const current = await loadProjectVariables(projectPath);
                  await persistProjectVariables(projectPath, { ...current, ...result.modifiedVariables });
                }
                resolve(result);
              } catch {
                resolve({
                  success: false, logs: [],
                  error: `Failed to parse Python output: ${stdout.slice(0, 500)}`,
                  cancelled: false, exitCode,
                });
              }
            });

            child.on("error", (err) => {
              resolve({
                success: false, logs: [],
                error: `Failed to spawn Python: ${err.message}`,
                cancelled: false, exitCode: -1,
              });
            });

            child.stdin.write(JSON.stringify(mergedPayload));
            child.stdin.end();
          });
        },
      );

      // ── Shell script runner ───────────────────────────────────────────────
      // Exposed as: ext:voiden-scripting:script:executeShell
      // Directly spawns bash — no intermediate Node.js subprocess.
      // Receives a pre-built bash script from the renderer (buildBashScript).
      // Placeholder paths (__VD_LOG__, etc.) are replaced here with real tmpDir paths.
      ctx.ipc.handle(
        "script:executeShell",
        async (event: any, payload: any): Promise<ScriptResult> => {
          if (process.platform === "win32") {
            return {
              success: false, logs: [],
              error: "Shell scripting is not supported on Windows. Use JavaScript or Python.",
              cancelled: false, exitCode: -1,
            };
          }

          let bashScript: string = payload.bashScript || "";
          const scriptBody: string = payload.scriptBody || "";
          if (!bashScript.trim()) {
            return {
              success: false, logs: [],
              error: "No bash script provided.",
              cancelled: false, exitCode: -1,
            };
          }

          const projectPath = await ctx.project.getActive(event);

          // Create isolated temp directory for this execution
          const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "voiden-shell-"));
          const scriptFile     = path.join(tmpDir, "script.sh");
          const userScriptFile = path.join(tmpDir, "user-script.sh");
          const logFile        = path.join(tmpDir, "logs.tsv");
          const varFile        = path.join(tmpDir, "vars.tsv");
          const assertFile     = path.join(tmpDir, "asserts.tsv");
          const cancelFile     = path.join(tmpDir, "cancel");
          const reqFile        = path.join(tmpDir, "request.tsv");
          const respFile       = path.join(tmpDir, "response.tsv");

          // Replace placeholder paths embedded by buildBashScript() in scriptEngine.ts
          bashScript = bashScript
            .split("__VD_LOG__").join(logFile)
            .split("__VD_VAR__").join(varFile)
            .split("__VD_ASSERT__").join(assertFile)
            .split("__VD_CANCEL__").join(cancelFile)
            .split("__VD_REQUEST__").join(reqFile)
            .split("__VD_RESPONSE__").join(respFile)
            .split("__VD_USERSCRIPT__").join(userScriptFile);

          // Write user script to its own file so bash syntax errors don't abort the wrapper
          fsSync.writeFileSync(userScriptFile, scriptBody, { mode: 0o644 });
          fsSync.writeFileSync(scriptFile, bashScript, { mode: 0o755 });
          fsSync.writeFileSync(logFile, "");
          fsSync.writeFileSync(varFile, "");
          fsSync.writeFileSync(assertFile, "");
          fsSync.writeFileSync(reqFile, "");
          fsSync.writeFileSync(respFile, "");

          const cleanup = () => {
            try { fsSync.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
          };

          return new Promise<ScriptResult>((resolve) => {
            let stderr = "";
            const killTimer = setTimeout(() => { child.kill("SIGKILL"); }, SCRIPT_TIMEOUT_MS);

            const child = spawn("bash", [scriptFile], {
              stdio: ["ignore", "ignore", "pipe"],
              cwd: projectPath || undefined,
              env: { ...process.env, PATH: EXTENDED_PATH },
            });
            child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

            child.on("close", async (code) => {
              clearTimeout(killTimer);

              const logRows    = readTsvB64(logFile);
              const varRows    = readTsvB64(varFile);
              const assertRows = readTsvB64(assertFile);
              const reqRows    = readTsvB64(reqFile);
              const respRows   = readTsvB64(respFile);
              const cancelled  = fsSync.existsSync(cancelFile);

              const logs: Array<{ level: string; args: any[] }> =
                logRows.map((row) => ({ level: row[0] || "log", args: [row[1] || ""] }));
              if (stderr.trim()) logs.push({ level: "error", args: [`[stderr] ${stderr.trim()}`] });

              const assertions = assertRows.map((row) => ({
                passed: row[0] === "true",
                message: row[4] || "",
                condition: `${row[1] || ""} ${row[2] || ""} ${row[3] || ""}`,
                actualValue: row[1] || "",
                operator: row[2] || "",
                expectedValue: row[3] || "",
              }));

              const modifiedVariables: Record<string, any> = {};
              varRows.forEach((row) => { if (row[0]) modifiedVariables[row[0]] = row[1] || ""; });

              const reqMap: Record<string, string> = {};
              reqRows.forEach((row) => { if (row[0]) reqMap[row[0]] = row[1] || ""; });
              const modifiedRequest = Object.keys(reqMap).length > 0
                ? {
                    url: reqMap["url"] || "",
                    method: reqMap["method"] || "GET",
                    body: reqMap["body"] ?? undefined,
                    headers: safeJson(reqMap["headers"], []),
                    queryParams: safeJson(reqMap["queryParams"], []),
                    pathParams: safeJson(reqMap["pathParams"], []),
                  }
                : undefined;

              const respMap: Record<string, string> = {};
              respRows.forEach((row) => { if (row[0]) respMap[row[0]] = row[1] || ""; });
              const modifiedResponse = Object.keys(respMap).length > 0
                ? {
                    status: respMap["status"] !== undefined ? (Number(respMap["status"]) || respMap["status"]) : undefined,
                    statusText: respMap["statusText"] ?? undefined,
                    body: respMap["body"] !== undefined ? safeJson(respMap["body"], respMap["body"]) : undefined,
                  }
                : undefined;

              if (modifiedVariables && Object.keys(modifiedVariables).length > 0) {
                const current = await loadProjectVariables(projectPath);
                await persistProjectVariables(projectPath, { ...current, ...modifiedVariables });
              }

              cleanup();
              resolve({
                success: code === 0,
                logs,
                assertions,
                cancelled,
                exitCode: code ?? -1,
                modifiedRequest,
                modifiedResponse,
                modifiedVariables,
              });
            });

            child.on("error", (err) => {
              clearTimeout(killTimer);
              cleanup();
              resolve({
                success: false, logs: [],
                error: `Failed to spawn bash: ${err.message}`,
                cancelled: false, exitCode: -1,
              });
            });
          });
        },
      );
    },

    async onunload() {
      ctx.ipc.removeHandler("script:executeNode");
      ctx.ipc.removeHandler("script:executePython");
      ctx.ipc.removeHandler("script:executeShell");
    },
  };
}
