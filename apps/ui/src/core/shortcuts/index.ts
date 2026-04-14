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

type Shortcut =
  | "CloseTab"
  | "CommandPaletteCommands"
  | "CommandPaletteFiles"
  | "Find"
  | "FindAndReplace"
  | "FindNext"
  | "FindPrev"
  | "NewFile"
  | "NextTab"
  | "PrevTab"
  | "ReloadTab"
  | "SendRequest"
  | "ToggleCheckoutBranch"
  | "ToggleCompareBranches"
  | "ToggleExplorer"
  | "ToggleEnvSelector"
  | "ToggleRecentProjectsSelector"
  | "ToggleResponsePanel"
  | "ToggleSidebar"
  | "ToggleTerminal";

const primaryModifier = isMac ? Modifiers.Meta : Modifiers.Ctrl;

const shortcuts = {
  CloseTab: { code: "KeyW", modifiers: primaryModifier },
  CommandPaletteCommands: {
    code: "KeyP",
    modifiers: primaryModifier | Modifiers.Shift,
  },
  CommandPaletteFiles: { code: "KeyP", modifiers: primaryModifier },
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
  PrevTab: {
    code: "BracketLeft",
    modifiers: primaryModifier | Modifiers.Shift,
  },
  ReloadTab: { code: "KeyR", modifiers: primaryModifier },
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
} as const satisfies Record<Shortcut, Keybind>;

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
