import { isMac } from "@/core/lib/utils";

type Keybind = {
  code: string;
  modifiers: Modifiers;
};

enum Modifiers {
  None = 0,
  Alt = 1 << 0,
  Ctrl = 1 << 1,
  Meta = 1 << 2,
  Shift = 1 << 3,
}

const primaryModifier = isMac ? Modifiers.Meta : Modifiers.Ctrl;

const shortcuts = {
  // Ctrl (not primaryModifier) is intentional: ctrl+L is the readline
  // convention for clearing a terminal on all platforms, including macOS.
  ClearTerminal: { code: "KeyL", modifiers: Modifiers.Ctrl },
  CloseTab: { code: "KeyW", modifiers: primaryModifier },
  CommandPaletteCommands: {
    code: "KeyP",
    modifiers: primaryModifier | Modifiers.Shift,
  },
  CommandPaletteFiles: { code: "KeyP", modifiers: primaryModifier },
  Copy: { code: "KeyC", modifiers: primaryModifier },
  Find: {
    code: "KeyF",
    modifiers: primaryModifier,
  },
  FindAndReplace: {
    code: "KeyH",
    modifiers: primaryModifier,
  },
  FindNext: {
    code: "KeyG",
    modifiers: primaryModifier,
  },
  FindPrev: {
    code: "KeyG",
    modifiers: primaryModifier | Modifiers.Shift,
  },
  NewFile: {
    code: "KeyN",
    modifiers: primaryModifier,
  },
  NextTab: {
    code: "BracketRight",
    modifiers: primaryModifier | Modifiers.Shift,
  },
  Paste: { code: "KeyV", modifiers: primaryModifier },
  PrevTab: {
    code: "BracketLeft",
    modifiers: primaryModifier | Modifiers.Shift,
  },
  ReloadTab: { code: "KeyR", modifiers: primaryModifier },
  SelectAll: { code: "KeyA", modifiers: primaryModifier },
  SendRequest: { code: "Enter", modifiers: primaryModifier },
  ToggleCheckoutBranch: {
    code: "KeyB",
    modifiers: primaryModifier | Modifiers.Alt,
  },
  ToggleCompareBranches: {
    code: "KeyD",
    modifiers:
      // On mac Meta + Alt + D collides with show/hide dock.
      primaryModifier |
      (isMac ? Modifiers.Alt | Modifiers.Shift : Modifiers.Alt),
  },
  ToggleExplorer: {
    code: "KeyE",
    modifiers: primaryModifier | Modifiers.Shift,
  },
  ToggleEnvSelector: {
    code: "KeyE",
    modifiers: primaryModifier | Modifiers.Alt,
  },
  ToggleRecentProjectsSelector: {
    code: "KeyO",
    modifiers: primaryModifier | Modifiers.Alt,
  },
  ToggleResponsePanel: { code: "KeyY", modifiers: primaryModifier },
  ToggleSidebar: { code: "KeyB", modifiers: primaryModifier },
  ToggleTerminal: { code: "KeyJ", modifiers: primaryModifier },
} as const satisfies Record<string, Keybind>;

type Shortcut = keyof typeof shortcuts;

export function getShortcutLabel(shortcut: Shortcut): string {
  const bind = shortcuts[shortcut];
  const parts: string[] = [];
  if (bind.modifiers & Modifiers.Shift) parts.push(isMac ? "⇧" : "Shift+");
  if (bind.modifiers & Modifiers.Ctrl) parts.push(isMac ? "⌃" : "Ctrl+");
  if (bind.modifiers & Modifiers.Alt) parts.push(isMac ? "⌥" : "Alt+");
  if (bind.modifiers & Modifiers.Meta) parts.push("⌘");

  const keyLabel = bind.code
    .replace("Key", "")
    .replace("Digit", "")
    .toUpperCase();
  parts.push(keyLabel);
  return parts.join("");
}

export function matchesShortcut(shortcut: Shortcut, event: KeyboardEvent) {
  const keybind = shortcuts[shortcut];
  if (event.code !== keybind.code) {
    return false;
  }

  let modifiers = Modifiers.None;

  if (event.altKey) modifiers |= Modifiers.Alt;
  if (event.ctrlKey) modifiers |= Modifiers.Ctrl;
  if (event.metaKey) modifiers |= Modifiers.Meta;
  if (event.shiftKey) modifiers |= Modifiers.Shift;

  if (modifiers !== keybind.modifiers) {
    return false;
  }

  return true;
}
