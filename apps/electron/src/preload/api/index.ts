import { coreApi } from "./core";
import { filesApi } from "./files";
import { gitApi } from "./git";
import { stateApi } from "./state";
import { terminalApi } from "./terminal";
import { themesApi } from "./themes";
import { autosaveApi } from "./autosave";
import { loggerAPI, processMonitorAPI } from "../loggerBridge";
import {
  directoriesApi,
  dialogApi,
  editorApi,
  pluginsApi,
  tabApi,
  sidebarApi,
  settingsApi,
  extensionsApi,
  coreExtensionsApi,
  ipcApi,
  voidenApi,
  envApi,
  requestApi,
  scriptApi,
  fileLinkApi,
  utilsApi,
  userSettingsApi,
  pluginSettingsApi,
  fontsApi,
  cliApi,
  skillsApi,
  variablesApi,
  projectApi,
  mainWindow
} from "./misc";

export const electronApi = {
  ...coreApi,
  utils: utilsApi,
  dialog: dialogApi,
  directories: directoriesApi,
  files: filesApi,
  editor: editorApi,
  git: gitApi,
  plugins: pluginsApi,
  state: stateApi,
  variables:variablesApi,
  tab: tabApi,
  sidebar: sidebarApi,
  terminal: terminalApi,
  settings: settingsApi,
  extensions: extensionsApi,
  coreExtensions: coreExtensionsApi,
  ipc: ipcApi,
  voiden: voidenApi,
  env: envApi,
  request: requestApi,
  script: scriptApi,
  fileLink: fileLinkApi,
  userSettings: userSettingsApi,
  pluginSettings: pluginSettingsApi,
  fonts: fontsApi,
  cli: cliApi,
  skills: skillsApi,
  themes: themesApi,
  autosave: autosaveApi,
  project: projectApi,
  mainwindow: mainWindow,
  logger: loggerAPI,
  processMonitor: processMonitorAPI,
  platform: process.platform,
};
