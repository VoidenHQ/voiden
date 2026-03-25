import { app } from "electron";
import fs from "fs/promises";
import path from "path";
import { AppState, AppSettings, PanelElement } from "src/shared/types";
import { windowManager } from "./windowManager";

const apiReadme = `# Voiden API Extension

## Overview

The **Voiden API Extension** provides a streamlined way for Voiden users to build and manage REST API calls through a set of configurable blocks. Each block corresponds to a component of an HTTP request, making it easier to define endpoints, headers, parameters, and body content without having to code everything from scratch. By combining these blocks, you can quickly set up and customize your API calls in a modular, low-code environment.

## Available Blocks & Usage

Below is a list of the blocks available in this extension, along with the commands used to insert them:

### 1. Endpoint

- **Slash Command**: \`/endpoint\`
- **Purpose**: Creates a block where you can add a base URL and select the request method (e.g., GET, POST, PUT, DELETE).
- **Usage**:
  1. Insert the block using the slash command.
  2. Specify the base URL (e.g., \`https://api.example.com/v1/resource\`).
  3. Select the request type.

### 2. Headers

- **Slash Command**: \`/headers\`
- **Purpose**: Creates a table where you can specify the headers for the request (e.g., \`Authorization\`, \`Content-Type\`).
- **Usage**:
  1. Insert the block using the slash command.
  2. Add rows for each header key-value pair.

### 3. Query Table

- **Slash Command**: \`/query\`
- **Purpose**: Creates a table where you can specify query parameters for the request.
- **Usage**:
  1. Insert the block using the slash command.
  2. Define each parameter name and value (e.g., \`page=2\`, \`sort=desc\`).
  3. These parameters will be appended to the endpoint URL.

### 4. Multipart Table

- **Slash Command**: \`/multipart\`
- **Purpose**: Creates a table where you can send files or shared files as multipart form-data.
- **Usage**:
  1. Insert the block using the slash command.
  2. For each row, specify the name of the field and the file to be sent.
  3. Ideal for file uploads or form submissions that require file data.

### 5. URL Table

- **Slash Command**: \`/urltable\`
- **Purpose**: Creates a table where you can send URL-encoded form data.
- **Usage**:
  1. Insert the block using the slash command.
  2. Define each key-value pair to be included in the request body as \`application/x-www-form-urlencoded\`.

### 6. JSON

- **Slash Command**: \`/json\`
- **Purpose**: Lets you specify the JSON body content for the request.
- **Usage**:
  1. Insert the block using the slash command.
  2. Enter valid JSON data (e.g., \`{"key": "value"}\`).

Once all blocks are configured, you can execute the request and get the response in response panel

---

## Feedback & Support

If you have any questions, feature requests, or need support, feel free to reach out through [email](mailto:hello@apyhub.com) or discord. We're always looking to improve the experience for everyone using the Voiden API Extension.`;

// Change the file paths as needed.
const SETTINGS_FILE = path.join(
  app.getPath("userData"),
  "voiden-settings.json",
);
const ONBOARDING_FILE = path.join(app.getPath("userData"), "onboarding.json");

/**
 * Load onboarding status from its dedicated file.
 * If the file doesn't exist (first launch), check whether any window-state
 * files already exist to distinguish a fresh install from an existing user.
 */
export async function loadOnboardingState(): Promise<boolean> {
  try {
    const data = await fs.readFile(ONBOARDING_FILE, "utf8");
    return JSON.parse(data).onboarding === true;
  } catch {
    // File missing — derive initial value from existing window states
    const stateDir = path.join(app.getPath("userData"), "window-states");
    let hasWindowState = false;
    try {
      const files = await fs.readdir(stateDir);
      hasWindowState = files.some((f) => f.endsWith(".json"));
    } catch {
      // Directory doesn't exist yet — truly fresh install
    }
    await saveOnboardingState(hasWindowState);
    return hasWindowState;
  }
}

export async function saveOnboardingState(value: boolean): Promise<void> {
  await fs.writeFile(ONBOARDING_FILE, JSON.stringify({ onboarding: value }), "utf8");
}
const AUTOSAVE_DIR = path.join(app.getPath("userData"), "autosave");

// Load or initialize state
export async function loadState(skipDefault?: boolean): Promise<AppState> {
  try {
    const STATE_FILE = windowManager.getStateFilePath();
    const data = await fs.readFile(STATE_FILE, "utf8");
    const state = JSON.parse(data) as AppState;

    // Onboarding is managed by a dedicated file — override whatever is in the state.
    state.onboarding = await loadOnboardingState();

    // Migration: Add git source control tab if it doesn't exist
    if (
      state.sidebars?.left &&
      !state.sidebars.left.tabs.some((tab) => tab.type === "gitSourceControl")
    ) {
      const gitSourceControlId = crypto.randomUUID();
      // Insert git tab after file explorer (index 1)
      state.sidebars.left.tabs.splice(1, 0, {
        id: gitSourceControlId,
        type: "gitSourceControl",
      });
      await saveState(state);
    }

    return state;
  } catch (err) {
    // console.warn("Could not load state file, using default state", err);

    // Create a new state for first launch or recovery
    const defaultState = await getDefaultState(skipDefault);
    defaultState.id = windowManager.activeWindowId;
    defaultState.onboarding = await loadOnboardingState();
    await saveState(defaultState);
    return defaultState;
  }
}

// Save state to file.
export async function saveState(state: AppState): Promise<void> {
  const STATE_FILE = windowManager.getStateFilePath();
  await fs.writeFile(STATE_FILE, JSON.stringify({ ...state }, null, 2), "utf8");
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    // Check if the settings file exists
    const fileExists = await fs
      .access(SETTINGS_FILE)
      .then(() => true)
      .catch(() => false);

    if (!fileExists) {
      // console.warn("Settings file not found, creating default settings.");
      const defaultSettings = getDefaultSettings();
      await saveSettings(defaultSettings);
      return defaultSettings;
    }

    // If the file exists, read and parse it
    const data = await fs.readFile(SETTINGS_FILE, "utf8");
    return JSON.parse(data) as AppSettings;
  } catch (err) {
    // console.warn("Error reading settings file, creating default settings.", err);
    const defaultSettings = getDefaultSettings();
    await saveSettings(defaultSettings);
    return defaultSettings;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

async function getDefaultState(_skipDefault?: boolean): Promise<AppState> {
  const fileExplorerId = crypto.randomUUID();
  const gitSourceControlId = crypto.randomUUID();
  const extensionBrowserId = crypto.randomUUID();
  const responsePanelId = crypto.randomUUID();
  const historyPanelId = crypto.randomUUID();
  const globalHistoryPanelId = crypto.randomUUID();

  // Fresh first window: onboarding=false triggers the modal (!onboarding → show).
  // Subsequent windows: onboarding=true skips it (user already completed onboarding).
  const isFirstWindow = windowManager.getAllWindows().length === 0;
  return {
    id: null,
    activeDirectory: null,
    onboarding: !isFirstWindow,
    showOnboarding: isFirstWindow,
    directories: {},
    unsaved: {
      layout: {
        id: "group",
        type: "group",
        children: [
          {
            id: "main",
            type: "panel",
            tabs: [],
            activeTabId: null,
          },
          {
            id: "bottom",
            type: "panel",
            tabs: [],
            activeTabId: null,
          },
        ],
      },
      activeEnv: null,
    },
    sidebars: {
      left: {
        activeTabId: fileExplorerId,
        tabs: [
          {
            id: fileExplorerId,
            type: "fileExplorer",
          },
          {
            id: gitSourceControlId,
            type: "gitSourceControl",
          },
          {
            id: extensionBrowserId,
            type: "extensionBrowser",
          },
          {
            id: globalHistoryPanelId,
            type: "globalHistory",
          },
        ],
      },
      right: {
        activeTabId: responsePanelId,
        tabs: [
          {
            id: responsePanelId,
            type: "responsePanel",
          },
          {
            id: historyPanelId,
            type: "history",
          },
        ],
      },
    },
    extensions: [],
  };
}

function getDefaultSettings(): AppSettings {
  return {
    theme: "dark",
  };
}

export function getDefaultLayout() {
  return {
    id: "group",
    type: "group",
    children: [
      {
        id: "main",
        type: "panel",
        tabs: [],
        activeTabId: null,
      },
      {
        id: "bottom",
        type: "panel",
        tabs: [],
        activeTabId: null,
      },
    ],
  } as PanelElement;
}

// Ensure autosave directory exists
export async function ensureAutosaveDir() {
  try {
    await fs.mkdir(AUTOSAVE_DIR, { recursive: true });
  } catch (err) {
    // console.error("Failed to create autosave directory:", err);
  }
}

// Save unsaved file content to autosave directory
export async function saveAutosaveFile(
  tabId: string,
  content: string,
): Promise<void> {
  await ensureAutosaveDir();
  const filePath = path.join(AUTOSAVE_DIR, `${tabId}.json`);
  await fs.writeFile(filePath, content, "utf8");
}

// Load autosaved file content
export async function loadAutosaveFile(tabId: string): Promise<string | null> {
  try {
    const filePath = path.join(AUTOSAVE_DIR, `${tabId}.json`);
    const content = await fs.readFile(filePath, "utf8");
    return content;
  } catch (err) {
    return null;
  }
}

// Delete autosaved file
export async function deleteAutosaveFile(tabId: string): Promise<void> {
  try {
    const filePath = path.join(AUTOSAVE_DIR, `${tabId}.json`);
    await fs.unlink(filePath);
  } catch (err) {
    // File doesn't exist or error deleting, ignore
  }
}

// Get all autosaved tab IDs
export async function getAutosavedTabIds(): Promise<string[]> {
  try {
    await ensureAutosaveDir();
    const files = await fs.readdir(AUTOSAVE_DIR);
    return files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(".json", ""));
  } catch (err) {
    return [];
  }
}

// Clean up autosaved files that are no longer in use
export async function cleanupAutosaveFiles(
  activeTabIds: Set<string>,
): Promise<void> {
  const autosavedIds = await getAutosavedTabIds();
  for (const tabId of autosavedIds) {
    if (!activeTabIds.has(tabId)) {
      await deleteAutosaveFile(tabId);
    }
  }
}
