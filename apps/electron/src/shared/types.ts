type TabType = "document" | "terminal" | "settings" | "extensionDetails" | "custom" | "welcome" | "changelog";

interface Meta {
  customTabKey?: string;
  extensionId?: string; // Which extension this tab is linked to
}

export interface Tab {
  id: string;
  type: TabType|string;
  title: string;
  source: string | null;
  directory?: string | null;
  // Meta information for extension tabs
  meta?: Meta;
}

interface Panel {
  id: string;
  type: "panel";
  tabs: Tab[];
  activeTabId: string;
}

interface PanelGroup {
  id: string;
  type: "group";
  children: Panel[];
}

export type PanelElement = Panel | PanelGroup;

interface LayoutState {
  layout: PanelElement;
  activeEnv?: string;
  activeProfile?: string;
  hidden?:boolean
}

export interface ExtensionData {
  id: string;
  type: "core" | "community";
  name: string;
  description: string;
  author: string;
  version: string;
  enabled: boolean;
  readme: string;
  repo?: string; // for community extensions
  installedPath?: string; // for installed community extensions
  capabilities?: any; // capabilities from manifest
  features?: string[]; // features from manifest
  dependencies?: any; // dependencies from manifest
}

// SIDEBAR PANELS LOGIC
// define sidebar tab types – these are the minimal bits that go in left/right sidebars
type SidebarTabType = "fileExplorer" | "settings" | "extensionBrowser" | "responsePanel" | "custom";

// a sidebar tab holds just enough info so the ui can render the appropriate icon/view,
// while extension-specific info is carried in meta (like extension id, view key, etc.)
export interface SidebarTab {
  id: string;
  type: SidebarTabType;
  meta?: Meta;
}

// a sidebar panel is just a list of tabs and an active tab indicator;
// typically, these sidebars are fixed, so rearranging/hiding them is optional
interface SidebarPanel {
  activeTabId: string;
  tabs: SidebarTab[];
}

// now, the sidebars state can be defined separately from the workspace state:
export interface SidebarsState {
  left: SidebarPanel;
  right: SidebarPanel;
}

export interface AppSettings {
  theme: "light" | "dark";
}

export interface AppState {
  id:number|null,
  activeDirectory: string | null;
  onboarding: boolean;
  directories: Record<string, LayoutState>;
  unsaved: LayoutState;
  sidebars: SidebarsState;
  showOnboarding: boolean;
  extensions: ExtensionData[];
}
