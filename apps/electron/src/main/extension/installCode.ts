import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

// The install code sent with the daily activity report (see activity.ts): a
// one-way hash of the operating system's machine id, so the same machine
// counts as one install even after its app data is cleared. The machine id
// itself never leaves this process, and voiden.md's collector hashes the code
// again with a secret of its own before storing it. Turned off by setting
// activity.install_code to false; the report then goes out without it.

// Fixed, public label: it only keeps this hash from matching what any other
// software derives from the same machine id.
const SCOPE = "voiden-install-v1";

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5_000, windowsHide: true }, (error, stdout) => resolve(error ? "" : String(stdout)));
  });
}

async function readMachineId(): Promise<string> {
  try {
    if (process.platform === "darwin") {
      const out = await run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
      return out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? "";
    }
    if (process.platform === "win32") {
      const out = await run("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]);
      return out.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] ?? "";
    }
    for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      const id = (await fs.readFile(file, "utf8").catch(() => "")).trim();
      if (id) return id;
    }
  } catch {
    // No machine id: the report is sent without an install code.
  }
  return "";
}

export function hashMachineId(machineId: string): string {
  const id = machineId.trim().toLowerCase();
  return id ? createHash("sha256").update(`${SCOPE}:${id}`).digest("hex").slice(0, 32) : "";
}

let cached: Promise<string> | null = null;

/** 32 hex characters, or "" when the machine id can't be read. */
export function installCode(): Promise<string> {
  cached ??= readMachineId().then(hashMachineId);
  return cached;
}
