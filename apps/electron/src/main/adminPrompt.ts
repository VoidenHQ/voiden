/**
 * Helpers for running a command with administrator rights.
 *
 * On macOS this uses the system password dialog through `osascript`
 * ("with administrator privileges"). sudo-prompt runs a bundled helper app
 * that is built for Intel only, so on Apple Silicon Macs without Rosetta it
 * failed at once with "Bad CPU type in executable" and never asked for a
 * password.
 */

/** Quote a value as an AppleScript string literal. */
export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** The osascript arguments that run `command` as an administrator, asking with `prompt`. */
export function macAdminArgs(command: string, prompt: string): string[] {
  return ["-e", `do shell script ${appleScriptString(command)} with prompt ${appleScriptString(prompt)} with administrator privileges`];
}

const errorText = (error: unknown): string => {
  const e = error as { message?: string; stderr?: string } | null;
  return `${e?.stderr ?? ""} ${e?.message ?? ""}`;
};

/** True when the user closed the password dialog instead of the command failing. */
export function isPromptCancelled(error: unknown): boolean {
  // macOS: "User canceled. (-128)". sudo-prompt (Linux): "User did not grant permission."
  return /\(-128\)|user cancell?ed|did not grant permission/i.test(errorText(error));
}

/** A short, readable reason for a failed admin command. */
export function promptFailureReason(error: unknown): string {
  const text = errorText(error)
    .replace(/^\s*Command failed:.*$/m, "")
    .replace(/\s*\(-?\d+\)\s*$/, "")
    .replace(/^\s*\d+:\d+:\s*execution error:\s*/i, "")
    .trim();
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean);
  return (firstLine || "Unknown error").replace(/[.\s]+$/, "");
}
