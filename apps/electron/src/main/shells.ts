/**
 * Which shells the integrated terminal can start (#598).
 *
 * Detection only checks for files (plus reading /etc/shells): no processes are
 * spawned, and the result is cached for the session.
 *
 * - macOS / Linux: the user's $SHELL, the shells in /etc/shells, and common
 *   extra shells (fish, nu, pwsh, …) found on PATH or in Homebrew's bin dirs.
 * - Windows: PowerShell 7, Windows PowerShell, Command Prompt, Git Bash, WSL.
 *   PowerShell 7 installed via winget is an "app execution alias" in
 *   %LOCALAPPDATA%\Microsoft\WindowsApps; that's a reparse point fs.stat can't
 *   follow, so existence is checked with lstat (see pulsar-edit/terminal#28).
 */

import * as fs from "fs";
import * as path from "path";

export interface ShellProfile {
  /** Stable id stored in settings and on terminal tabs: "zsh", "pwsh", "gitbash", … or an absolute path for a custom shell. */
  id: string;
  name: string;
  path: string;
  args: string[];
}

export interface ShellEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** True if something exists at this path (lstat semantics). */
  exists(p: string): boolean;
  readFile(p: string): string | null;
}

export const nodeShellEnv = (): ShellEnv => ({
  platform: process.platform,
  env: process.env,
  exists: (p) => {
    try {
      fs.lstatSync(p);
      return true;
    } catch {
      return false;
    }
  },
  readFile: (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
});

// Shells that load the user's profile (.zprofile, .bash_profile, …) with -l, as the terminal always did.
const LOGIN_FLAG_SHELLS = new Set(["bash", "zsh", "sh", "ksh", "mksh", "dash", "fish", "tcsh", "csh", "nu"]);
const POSIX_EXTRA_SHELLS = ["fish", "nu", "pwsh", "xonsh", "elvish"];
const POSIX_EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
const DISPLAY_NAMES: Record<string, string> = { pwsh: "PowerShell", nu: "Nushell" };

const basenameOf = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.exe$/i, "");

function posixProfile(shellPath: string): ShellProfile {
  const id = basenameOf(shellPath);
  return { id, name: DISPLAY_NAMES[id] ?? id, path: shellPath, args: LOGIN_FLAG_SHELLS.has(id) ? ["-l"] : [] };
}

function detectPosix(sys: ShellEnv): ShellProfile[] {
  const candidates: string[] = [];
  if (sys.env.SHELL) candidates.push(sys.env.SHELL);

  for (const line of (sys.readFile("/etc/shells") ?? "").split("\n")) {
    const p = line.trim();
    if (p && !p.startsWith("#")) candidates.push(p);
  }

  const dirs = [...(sys.env.PATH ?? "").split(":").filter(Boolean), ...POSIX_EXTRA_DIRS];
  for (const name of POSIX_EXTRA_SHELLS) {
    for (const dir of dirs) candidates.push(path.posix.join(dir, name));
  }

  // One entry per shell name; the first found wins, so $SHELL keeps its exact path.
  const byId = new Map<string, ShellProfile>();
  for (const p of candidates) {
    const id = basenameOf(p);
    if (!byId.has(id) && path.posix.isAbsolute(p) && sys.exists(p)) byId.set(id, posixProfile(p));
  }
  return [...byId.values()];
}

function detectWindows(sys: ShellEnv): ShellProfile[] {
  const env = sys.env;
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const localAppData = env.LOCALAPPDATA ?? "";
  const onPath = (exe: string) => (env.PATH ?? env.Path ?? "").split(";").filter(Boolean).map((d) => path.win32.join(d, exe));
  const first = (paths: string[]) => paths.find((p) => p && sys.exists(p));

  const found: ShellProfile[] = [];
  const add = (id: string, name: string, p: string | undefined, args: string[] = []) => {
    if (p) found.push({ id, name, path: p, args });
  };

  add("pwsh", "PowerShell", first([
    path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    path.win32.join(programFiles, "PowerShell", "7-preview", "pwsh.exe"),
    ...onPath("pwsh.exe"),
    localAppData && path.win32.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe"),
  ]));
  add("powershell", "Windows PowerShell", first([path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")]));
  add("cmd", "Command Prompt", first([env.ComSpec ?? "", path.win32.join(systemRoot, "System32", "cmd.exe")]));
  add("gitbash", "Git Bash", first([
    path.win32.join(programFiles, "Git", "bin", "bash.exe"),
    path.win32.join(programFilesX86, "Git", "bin", "bash.exe"),
    localAppData && path.win32.join(localAppData, "Programs", "Git", "bin", "bash.exe"),
  ]), ["--login", "-i"]);
  add("wsl", "WSL", first([path.win32.join(systemRoot, "System32", "wsl.exe")]));
  return found;
}

export function detectShells(sys: ShellEnv): ShellProfile[] {
  return sys.platform === "win32" ? detectWindows(sys) : detectPosix(sys);
}

/** The shell used when the user hasn't picked one: $SHELL on macOS/Linux, PowerShell 7 if installed on Windows. */
export function autoDefaultShell(shells: ShellProfile[], sys: ShellEnv): ShellProfile {
  const preferred =
    sys.platform === "win32"
      ? ["pwsh", "powershell", "cmd"]
      : [sys.env.SHELL ? basenameOf(sys.env.SHELL) : "", sys.platform === "darwin" ? "zsh" : "bash", "sh"];
  for (const id of preferred) {
    const match = shells.find((s) => s.id === id);
    if (match) return match;
  }
  if (shells[0]) return shells[0];
  // Nothing detected (unusual): the shells the terminal always used.
  return sys.platform === "win32"
    ? { id: "powershell", name: "Windows PowerShell", path: "powershell.exe", args: [] }
    : posixProfile(sys.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
}

/**
 * Turn a requested shell (a profile id, a custom absolute path, or "" for
 * automatic) into a profile. An unknown or missing shell falls back to the
 * automatic default, and `unavailable` says what couldn't be used.
 */
export function resolveShell(
  requested: string | undefined,
  shells: ShellProfile[],
  sys: ShellEnv,
): { profile: ShellProfile; unavailable?: string } {
  const wanted = requested?.trim();
  if (!wanted) return { profile: autoDefaultShell(shells, sys) };

  const known = shells.find((s) => s.id === wanted);
  if (known) return { profile: known };

  const isAbsolute = sys.platform === "win32" ? path.win32.isAbsolute(wanted) : path.posix.isAbsolute(wanted);
  if (isAbsolute && sys.exists(wanted)) {
    const profile = sys.platform === "win32"
      ? { id: wanted, name: basenameOf(wanted), path: wanted, args: [] }
      : { ...posixProfile(wanted), id: wanted };
    return { profile };
  }
  return { profile: autoDefaultShell(shells, sys), unavailable: wanted };
}

let cached: ShellProfile[] | null = null;

/** Detected shells for this machine, cached for the session. */
export function getShells(refresh = false): ShellProfile[] {
  if (!cached || refresh) cached = detectShells(nodeShellEnv());
  return cached;
}
