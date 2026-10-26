import { describe, expect, it } from "vitest";
import { appleScriptString, isPromptCancelled, macAdminArgs, promptFailureReason } from "../adminPrompt";

describe("appleScriptString", () => {
  it("escapes quotes and backslashes", () => {
    expect(appleScriptString('ln -sf "/a b/c" "/usr/local/bin/voiden"')).toBe('"ln -sf \\"/a b/c\\" \\"/usr/local/bin/voiden\\""');
    expect(appleScriptString("C:\\path")).toBe('"C:\\\\path"');
  });
});

describe("macAdminArgs", () => {
  it("runs the command with administrator privileges and a prompt", () => {
    const [flag, script] = macAdminArgs('rm -f "/usr/local/bin/voiden"', "Voiden wants to remove it.");
    expect(flag).toBe("-e");
    expect(script).toBe('do shell script "rm -f \\"/usr/local/bin/voiden\\"" with prompt "Voiden wants to remove it." with administrator privileges');
  });
});

describe("isPromptCancelled", () => {
  it("detects the macOS cancel error", () => {
    expect(isPromptCancelled({ message: "Command failed: osascript -e ...", stderr: "0:105: execution error: User canceled. (-128)\n" })).toBe(true);
  });

  it("detects the sudo-prompt cancel error", () => {
    expect(isPromptCancelled(new Error("User did not grant permission."))).toBe(true);
  });

  it("does not treat real failures as cancelled", () => {
    expect(isPromptCancelled({ message: "Command failed: ./applet\n/bin/sh: ./applet: Bad CPU type in executable" })).toBe(false);
    expect(isPromptCancelled({ stderr: "0:120: execution error: ln: /usr/local/bin/voiden: No such file or directory (1)" })).toBe(false);
    expect(isPromptCancelled(null)).toBe(false);
  });
});

describe("promptFailureReason", () => {
  it("keeps only the readable part of an osascript error", () => {
    expect(promptFailureReason({ message: "Command failed: osascript -e do shell script", stderr: "0:120: execution error: ln: /usr/local/bin/voiden: No such file or directory (1)\n" })).toBe("ln: /usr/local/bin/voiden: No such file or directory");
  });

  it("drops the trailing period so the sentence reads well", () => {
    expect(promptFailureReason(new Error("Something went wrong."))).toBe("Something went wrong");
  });

  it("falls back when there is nothing to show", () => {
    expect(promptFailureReason({})).toBe("Unknown error");
  });
});
