import { describe, expect, it } from "vitest";
import { autoDefaultShell, detectShells, resolveShell, type ShellEnv } from "../shells";

function fakeSystem(platform: NodeJS.Platform, files: string[], env: Record<string, string> = {}, etcShells?: string): ShellEnv {
  const existing = new Set(files);
  return {
    platform,
    env,
    exists: (p) => existing.has(p),
    readFile: (p) => (p === "/etc/shells" ? etcShells ?? null : null),
  };
}

describe("detectShells on macOS / Linux", () => {
  const linux = fakeSystem(
    "linux",
    ["/usr/bin/fish", "/bin/bash", "/usr/bin/bash", "/bin/sh", "/usr/bin/zsh", "/usr/local/bin/nu"],
    { SHELL: "/usr/bin/fish", PATH: "/usr/local/bin:/usr/bin:/bin" },
    "# /etc/shells\n/bin/sh\n/bin/bash\n/usr/bin/bash\n/usr/bin/zsh\n/usr/bin/fish\n/bin/tcsh\n",
  );

  it("lists $SHELL first, then /etc/shells and extra shells, one per name", () => {
    expect(detectShells(linux).map((s) => `${s.id}:${s.path}`)).toEqual([
      "fish:/usr/bin/fish",
      "sh:/bin/sh",
      "bash:/bin/bash",
      "zsh:/usr/bin/zsh",
      "nu:/usr/local/bin/nu",
    ]);
  });

  it("skips shells listed in /etc/shells that aren't installed", () => {
    expect(detectShells(linux).some((s) => s.id === "tcsh")).toBe(false);
  });

  it("starts login-capable shells with -l, others without", () => {
    const shells = detectShells(
      fakeSystem("darwin", ["/bin/zsh", "/opt/homebrew/bin/pwsh"], { SHELL: "/bin/zsh" }, "/bin/zsh\n"),
    );
    expect(shells.find((s) => s.id === "zsh")?.args).toEqual(["-l"]);
    expect(shells.find((s) => s.id === "pwsh")).toMatchObject({ name: "PowerShell", args: [] });
  });

  it("defaults to $SHELL", () => {
    expect(autoDefaultShell(detectShells(linux), linux).id).toBe("fish");
  });

  it("falls back to zsh on macOS when $SHELL isn't set", () => {
    const mac = fakeSystem("darwin", ["/bin/zsh", "/bin/bash"], {}, "/bin/bash\n/bin/zsh\n");
    expect(autoDefaultShell(detectShells(mac), mac).id).toBe("zsh");
  });
});

describe("detectShells on Windows", () => {
  const env = {
    SystemRoot: "C:\\Windows",
    ProgramFiles: "C:\\Program Files",
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    PATH: "C:\\Windows\\System32",
  };
  const base = [
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "C:\\Windows\\System32\\cmd.exe",
    "C:\\Windows\\System32\\wsl.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
  ];

  it("finds PowerShell 7 installed via winget (app execution alias) and prefers it", () => {
    const sys = fakeSystem("win32", [...base, "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe"], env);
    const shells = detectShells(sys);
    expect(shells.map((s) => s.id)).toEqual(["pwsh", "powershell", "cmd", "gitbash", "wsl"]);
    expect(shells[0].path).toBe("C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe");
    expect(shells.find((s) => s.id === "gitbash")?.args).toEqual(["--login", "-i"]);
    expect(autoDefaultShell(shells, sys).id).toBe("pwsh");
  });

  it("uses Windows PowerShell when PowerShell 7 isn't installed", () => {
    const sys = fakeSystem("win32", base, env);
    expect(autoDefaultShell(detectShells(sys), sys).id).toBe("powershell");
  });
});

describe("resolveShell", () => {
  const sys = fakeSystem("linux", ["/bin/bash", "/usr/bin/zsh", "/opt/custom/xsh"], { SHELL: "/bin/bash" }, "/bin/bash\n/usr/bin/zsh\n");
  const shells = detectShells(sys);

  it("uses the automatic default for an empty setting", () => {
    expect(resolveShell("", shells, sys)).toEqual({ profile: expect.objectContaining({ id: "bash" }) });
  });

  it("uses a detected shell by id", () => {
    expect(resolveShell("zsh", shells, sys).profile.path).toBe("/usr/bin/zsh");
  });

  it("accepts a custom absolute path", () => {
    expect(resolveShell("/opt/custom/xsh", shells, sys).profile).toMatchObject({ id: "/opt/custom/xsh", path: "/opt/custom/xsh" });
  });

  it("falls back to the default and reports a shell that's gone", () => {
    expect(resolveShell("fish", shells, sys)).toEqual({ profile: expect.objectContaining({ id: "bash" }), unavailable: "fish" });
    expect(resolveShell("/nope/sh", shells, sys).unavailable).toBe("/nope/sh");
  });
});
