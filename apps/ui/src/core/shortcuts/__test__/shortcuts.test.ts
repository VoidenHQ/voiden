// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock isMac before importing the module under test
let mockIsMac = true;
vi.mock("@/core/lib/utils", () => ({
  get isMac() {
    return mockIsMac;
  },
}));

function makeKeyEvent(
  code: string,
  mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
) {
  return {
    code,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  } as KeyboardEvent;
}

describe("shortcuts", () => {
  describe("mac", () => {
    let matchesShortcut: typeof import("../index").matchesShortcut;
    let getShortcutLabel: typeof import("../index").getShortcutLabel;

    beforeEach(async () => {
      mockIsMac = true;
      vi.resetModules();
      const mod = await import("../index");
      matchesShortcut = mod.matchesShortcut;
      getShortcutLabel = mod.getShortcutLabel;
    });

    describe("matchesShortcut", () => {
      it("voiden test : matches ToggleSidebar with Cmd+B", () => {
        expect(matchesShortcut("ToggleSidebar", makeKeyEvent("KeyB", { meta: true }))).toBe(true);
      });

      it("voiden test : rejects ToggleSidebar when extra modifiers are present", () => {
        expect(matchesShortcut("ToggleSidebar", makeKeyEvent("KeyB", { meta: true, shift: true }))).toBe(false);
      });

      it("voiden test : rejects ToggleSidebar with Ctrl instead of Cmd on Mac", () => {
        expect(matchesShortcut("ToggleSidebar", makeKeyEvent("KeyB", { ctrl: true }))).toBe(false);
      });

      it("voiden test : rejects when wrong key code", () => {
        expect(matchesShortcut("ToggleSidebar", makeKeyEvent("KeyX", { meta: true }))).toBe(false);
      });

      it("voiden test : matches FindPrev with Cmd+Shift+G", () => {
        expect(matchesShortcut("FindPrev", makeKeyEvent("KeyG", { meta: true, shift: true }))).toBe(true);
      });

      it("voiden test : distinguishes FindNext from FindPrev", () => {
        const next = makeKeyEvent("KeyG", { meta: true });
        const prev = makeKeyEvent("KeyG", { meta: true, shift: true });
        expect(matchesShortcut("FindNext", next)).toBe(true);
        expect(matchesShortcut("FindNext", prev)).toBe(false);
        expect(matchesShortcut("FindPrev", prev)).toBe(true);
        expect(matchesShortcut("FindPrev", next)).toBe(false);
      });

      it("voiden test : matches ToggleCheckoutBranch with Cmd+Alt+B", () => {
        expect(matchesShortcut("ToggleCheckoutBranch", makeKeyEvent("KeyB", { meta: true, alt: true }))).toBe(true);
      });

      it("voiden test : matches ToggleCompareBranches with Cmd+Alt+Shift+D on Mac", () => {
        expect(matchesShortcut("ToggleCompareBranches", makeKeyEvent("KeyD", { meta: true, alt: true, shift: true }))).toBe(true);
      });

      it("voiden test : rejects bare key with no modifiers", () => {
        expect(matchesShortcut("ToggleSidebar", makeKeyEvent("KeyB", {}))).toBe(false);
      });
    });

    describe("getShortcutLabel", () => {
      it("voiden test : returns Mac symbols for simple shortcut", () => {
        expect(getShortcutLabel("ToggleSidebar")).toBe("⌘B");
      });

      it("voiden test : returns Mac symbols with Shift", () => {
        expect(getShortcutLabel("CommandPaletteCommands")).toBe("⇧⌘P");
      });

      it("voiden test : returns Mac symbols with Alt", () => {
        expect(getShortcutLabel("ToggleCheckoutBranch")).toBe("⌥⌘B");
      });

      it("voiden test : returns Mac symbols with Alt+Shift", () => {
        expect(getShortcutLabel("ToggleCompareBranches")).toBe("⇧⌥⌘D");
      });
    });
  });

  describe("non-mac", () => {
    let matchesShortcut: typeof import("../index").matchesShortcut;
    let getShortcutLabel: typeof import("../index").getShortcutLabel;

    beforeEach(async () => {
      mockIsMac = false;
      vi.resetModules();
      const mod = await import("../index");
      matchesShortcut = mod.matchesShortcut;
      getShortcutLabel = mod.getShortcutLabel;
    });

    describe("matchesShortcut", () => {
      it("voiden test : matches ToggleSidebar with Ctrl+B", () => {
        expect(matchesShortcut("ToggleSidebar", makeKeyEvent("KeyB", { ctrl: true }))).toBe(true);
      });

      it("voiden test : rejects ToggleSidebar with Cmd on non-Mac", () => {
        expect(matchesShortcut("ToggleSidebar", makeKeyEvent("KeyB", { meta: true }))).toBe(false);
      });

      it("voiden test : matches ToggleCompareBranches with Ctrl+Alt+D on non-Mac", () => {
        expect(matchesShortcut("ToggleCompareBranches", makeKeyEvent("KeyD", { ctrl: true, alt: true }))).toBe(true);
      });
    });

    describe("getShortcutLabel", () => {
      it("voiden test : returns text labels for simple shortcut", () => {
        expect(getShortcutLabel("ToggleSidebar")).toBe("Ctrl+B");
      });

      it("voiden test : returns text labels with Shift", () => {
        expect(getShortcutLabel("CommandPaletteCommands")).toBe("Shift+Ctrl+P");
      });

      it("voiden test : returns text labels with Alt", () => {
        expect(getShortcutLabel("ToggleCheckoutBranch")).toBe("Ctrl+Alt+B");
      });
    });
  });
});
