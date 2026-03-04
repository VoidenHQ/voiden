import { coreApi } from "./core";
import { filesApi } from "./files";
import { gitApi } from "./git";
import { stateApi } from "./state";
import { terminalApi } from "./terminal";
import { themesApi } from "./themes";
import { autosaveApi } from "./autosave";
import {
  directoriesApi,
  dialogApi,
  editorApi,
  pluginsApi,
  tabApi,
  sidebarApi,
  settingsApi,
  extensionsApi,
  ipcApi,
  voidenApi,
  envApi,
  requestApi,
  scriptApi,
  fileLinkApi,
  utilsApi,
  userSettingsApi,
  fontsApi,
  cliApi,
  variablesApi,
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
  ipc: ipcApi,
  voiden: voidenApi,
  env: envApi,
  request: requestApi,
  script: scriptApi,
  fileLink: fileLinkApi,
  userSettings: userSettingsApi,
  fonts: fontsApi,
  cli: cliApi,
  themes: themesApi,
  autosave: autosaveApi,
  mainwindow:mainWindow
};
