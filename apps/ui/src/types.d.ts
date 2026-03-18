export interface FileTree {
  name: string;
  path: string;
  type: "file" | "folder";
  children: FileTree[] | undefined;
}

export interface FileTreeItem {
  path: string;
  type: "file" | "folder";
  name: string;
  isProjectRoot?: boolean;
}

export interface TabState {
  filePath: string;
  isActive: boolean;
  isDirty: boolean;
  displayName: string;
  lastAccessed: string;
}

export interface DocumentState {
  content: string;
  savedContent: string;
  lastModified: number;
  error: Error | null;
}

export interface SearchResult {
  path: string;
  line: number;
  preview: string;
}

export {};

declare global {
  interface Window {
    __EXTENSION_HOOK__?: string;
    electron?: {
      isApp: boolean;
      openExternal: (url: string) => void;
      onLogin: (
        callback: (event: Electron.IpcRendererEvent, url: string) => void,
      ) => void;
      removeListener: (channel: string) => void;
      sendRequest: (
        urlForRequest: string,
        fetchOptions: RequestInit,
        signalState?: {
          aborted: boolean;
        },
      ) => Promise<Response>;
      connectWss: (wsId: string) => Promise<void>;
      getVersion: () => Promise<string>;
      mainwindow: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
      };
      utils: {
        pathJoin: (...paths: string[]) => Promise<string>;
      };
      dialog: {
        openFile: (options: Electron.OpenDialogOptions) => Promise<string[]>;
      };
      directories: {
        list: () => Promise<string[]>;
        getActive: () => Promise<string | undefined>;
        setActive: (path: string) => Promise<void>;
        onChange: (callback: (directoryPath: string) => void) => () => void;
      };
      active: {
        getDocument: () => Promise<string | null>;
        setDocument: (path: string) => Promise<void>;
        getTabs: () => Promise<TabState[]>;
        addTab: (filePath: string) => Promise<void>;
        closeTab: (filePath: string) => Promise<void>;
        closeAllTabs: () => Promise<void>;
        closeTabsToRight: (filePath: string) => Promise<void>;
        closeOtherTabs: (filePath: string) => Promise<void>;
        setTabDirty: (filePath: string, isDirty: boolean) => Promise<void>;
        activateTab: (filePath: string) => Promise<void>;
        onTabsChanged: (callback: () => void) => () => void;
      };
      files: {
        tree: (projectName: string) => Promise<FileTree>;
        read: (path: string) => Promise<string>;
        write: (
          path: string | null,
          content: string,
          tabId?: string,
        ) => Promise<string | null>;
        create: (
          projectName: string,
          fileName: string,
        ) => Promise<{
          name: string;
          path: string;
        }>;
        createVoid: (
          projectName: string,
          fileName: string,
        ) => Promise<{
          name: string;
          path: string;
        }>;
        createDirectory: (path: string, dirName?: string) => Promise<string>;
        getDirectoryExist: (path: string, dirName?: string) => Promise<boolean>;
        getFileExist: (path: string, fileName?: string) => Promise<boolean>;
        createProjectDirectory: (data: string) => Promise<string>;
        bootstrapProject: (
          targetDirectory: string,
          withSampleProject: boolean,
          projectName?: string,
        ) => Promise<{ projectPath: string; welcomeFile: string | null }>;
        delete: (path: string) => Promise<boolean>;
        rename: (
          oldPath: string,
          newName: string,
        ) => Promise<{ success: boolean; error?: string }>;
        showFileContextMenu: (data: FileTreeItem) => void;
        showBulkDeleteMenu: (data: FileTreeItem[]) => void;
        onFileMenuCommand: (
          callback: (command: string, data: FileTreeItem) => void,
        ) => () => void;
        move: (
          dragIds: string[],
          parentId: string,
        ) => Promise<{
          success: boolean;
          moved: string[];
          conflicts: { dragId: string; targetPath: string; fileName: string }[];
          error?: string;
        }>;
        moveForce: (
          conflicts: { dragId: string; targetPath: string; fileName: string }[],
        ) => Promise<{ success: boolean; error?: string }>;
        deleteDirectory: (path: string) => Promise<boolean>;
        bulkDelete: (items: FileTreeItem[]) => Promise<boolean>;
        getFiles: (
          filePaths: string[],
          isExternal?: boolean,
        ) => Promise<
          {
            filePath: string;
            fileName: string;
            mimeType: string | null;
            data: string | null;
            error?: string;
          }[]
        >;
        getVoidFiles: () => Promise<
          {
            id: string;
            type: string;
            title: string;
            source: string;
            content: string;
          }[]
        >;
        drop: (
          targetPath: string,
          fileName: string,
          fileData: Uint8Array,
        ) => Promise<{ success: boolean; error?: string }>;
        dropFolder: (
          targetPath: string,
          sourcePath: string,
        ) => Promise<{
          success: boolean;
          name?: string;
          path?: string;
          error?: string;
        }>;
        onReferencesUpdated: (
          callback: (filePaths: string[]) => void,
        ) => () => void;
      };
      searchFiles: (query: string) => Promise<SearchResult[]>;
      git: {
        getBranches: () => Promise<{
          branches: string[];
          activeBranch: string;
        }>;
        checkout: (
          projectPath: string,
          branch: string,
        ) => Promise<{ activeBranch: string; branches: string[] }>;
        createBranch: (
          projectPath: string,
          branch: string,
        ) => Promise<{ activeBranch: string; branches: string[] }>;
        updateGitignore: (
          filePatterns: string | string[],
          rootDir?: string,
        ) => Promise<void>;
        diffBranches: (
          baseBranch: string,
          compareBranch: string,
        ) => Promise<{
        getBranches: () => Promise<{ branches: string[]; activeBranch: string }>;
        checkout: (projectPath: string, branch: string) => Promise<{ activeBranch: string; branches: string[] }>;
        createBranch: (projectPath: string, branch: string) => Promise<{ activeBranch: string; branches: string[] }>;
        createBranchFrom: (projectPath: string, branch: string, fromBranch: string) => Promise<{ activeBranch: string; branches: string[] }>;
        updateGitignore: (filePatterns: string | string[], rootDir?: string) => Promise<void>;
        diffBranches: (baseBranch: string, compareBranch: string) => Promise<{
          summary: { files: number; insertions: number; deletions: number };
          files: { status: string; path: string; oldPath: string | null }[];
        }>;
        diffFile: (
          baseBranch: string,
          compareBranch: string,
          filePath: string,
        ) => Promise<string>;
        getFileAtBranch: (
          branch: string,
          filePath: string,
        ) => Promise<string | null>;
        getRepoRoot: () => Promise<string | null>;
        getStatus: () => Promise<{
          files: { path: string; status: string }[];
          staged: string[];
          modified: string[];
          untracked: string[];
          deleted: string[];
          published: boolean;
          current: string;
          tracking: string | null;
          ahead: number;
          behind: number;
          outgoing: boolean;
        }>;
        clone: (repoUrl: string, token?: string) => Promise<{ clonedPath: string; clonedInPlace: boolean; isNewProject: boolean }>;
        stage: (files: string[]) => Promise<boolean>;
        unstage: (files: string[]) => Promise<boolean>;
        commit: (message: string) => Promise<any>;
        discard: (files: string[]) => Promise<boolean>;
        getLog: (limit?: number) => Promise<{
          all: {
            hash: string;
            shortHash: string;
            message: string;
            author: string;
            date: string;
            refs: string;
            parents: string[];
          }[];
          latest: any;
        }>;
        getCommitFiles: (commitHash: string) => Promise<
          {
            path: string;
            changes: number;
            insertions: number;
            deletions: number;
          }[]
        >;
        getCommitFiles: (commitHash: string) => Promise<{
          path: string;
          changes: number;
          insertions: number;
          deletions: number;
        }[]>;
        fetchRemote: () => Promise<boolean | null>;
        push: () => Promise<{ branch: string }>;
        pull: () => Promise<any>;
        stash: (message?: string) => Promise<boolean>;
        stashList: () => Promise<{ index: number; ref: string; message: string; date: string }[]>;
        stashPop: (index: number) => Promise<boolean>;
      };
      plugins: {
        get: () => Promise<string[]>;
      };
      state: {
        get: () => Promise<any>;
        getPanelTabs: (panelId: string) => Promise<any>;
        getProjects: () => Promise<any>;
        openProject: (projectPath: string) => Promise<any>;
        setActiveProject: (projectPath: string) => Promise<any>;
        addPanelTab: (
          panelId: string,
          tab: any,
        ) => Promise<{ tabId: string; alreadyExists: boolean }>;
        activatePanelTab: (
          panelId: string,
          tabId: string,
        ) => Promise<{ panelId: string; tabId: string }>;
        closePanelTab: (
          panelId: string,
          tabId: string,
          unsavedContent?: string,
        ) => Promise<{ panelId: string; tabId: string; canceled?: boolean }>;
        renameFile: (
          oldPath: string,
          newName: string,
        ) => Promise<{ success: boolean; error?: string }>;
        updateOnboarding: (onboarding: boolean) => Promise<any>;
        duplicatePanelTab: (
          panelId: string,
          tabId: string,
        ) => Promise<{ panelId: string; tabId: string }>;
        reloadPanelTab: (
          panelId: string,
          tabId: string,
        ) => Promise<{ panelId: string; tabId: string }>;
        reorderTabs: (panelId: string, tabs: any[]) => Promise<void>;
      };

      tab: {
        getContent: (tab: any) => Promise<any>;
        activate: (panelId: string, tabId: string) => Promise<any>;
        registerPanel: (panelId: string, tab: any) => Promise<any>;
        add: (tabId: string, tab: any) => Promise<any>;
        getActiveTab: () => Promise<any>;
      };
      terminal: {
        sendInput: (data: { id: string; data: string }) => void;
        onOutput: (id: string, callback: (data: string) => void) => () => void;
        attachOrCreate: (params: {
          tabId: string;
          cwd: string;
          cols?: number;
          rows?: number;
        }) => Promise<{ id: string; buffer: string; isNew: boolean }>;
        detach: (id: string) => void;
        resize: (data: { id: string; cols: number; rows: number }) => void;
        new: (panelId: string) => Promise<{ panelId: string; tabId: string }>;
        onExit: (
          id: string,
          callback: (exitInfo: { exitCode: number; signal: number }) => void,
        ) => () => void;
      };
      sidebar: {
        getTabs: (sidebarId: "left" | "right") => Promise<any>;
        activateTab: (
          sidebarId: "left" | "right",
          tabId: string,
        ) => Promise<any>;
        registerSidebarTab: (
          sidebarId: "left" | "right",
          tab: {
            extensionId: string;
            id: string;
            title: string;
          },
        ) => Promise<any>;
      };
      settings: {
        get: () => Promise<any>;
      };
      extensions: {
        getAll: () => Promise<any>;
        get: (extensionId: string) => Promise<any>;
        install: (extension: any) => Promise<any>;
        installFromZip: () => Promise<any>;
        uninstall: (extensionId: string) => Promise<any>;
        setEnabled: (extensionId: string, enabled: boolean) => Promise<any>;
        openDetails: (extension: any) => Promise<any>;
        update: (extensionId: string) => Promise<any>;
      };
      ipc: {
        on: (
          channel: string,
          listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void,
        ) => void;
        removeListener: (
          channel: string,
          listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void,
        ) => void;
        invoke: (channel: string, ...args: any[]) => Promise<any>;
      };
      voiden: {
        getApyFiles: (directory: string, currentFile: string) => Promise<any>;
        getBlockContent: (filePath: string) => Promise<any>;
      };
      env: {
        load: () => Promise<any>;
        setActive: (envPath: string) => Promise<any>;
        extendEnvs: (
          comment: string,
          variables: [{ key: string; value: Record<string, string> }],
        ) => Promise<void>;
        replaceVariables: (text: string) => Promise<string>;
        getKeys: () => Promise<string[]>;
        getYamlTrees: (profile?: string) => Promise<{
          public: Record<string, unknown>;
          private: Record<string, unknown>;
        }>;
        saveYamlTrees: (
          publicTree: Record<string, unknown>,
          privateTree: Record<string, unknown>,
          profile?: string,
        ) => Promise<void>;
        getProfiles: () => Promise<string[]>;
        setActiveProfile: (profile: string) => Promise<void>;
        createProfile: (profile: string) => Promise<void>;
        deleteProfile: (profile: string) => Promise<void>;
      };
      fileLink: {
        exists: (absolutePath: string) => Promise<boolean>;
      };
      userSettings: {
        get: () => Promise<any>;
        set: (patch: any) => Promise<any>;
        reset: () => Promise<any>;
        onChange: (callback: void) => Promise<any>;
      };
      themes: {
        list: () => Promise<{ id: string; name: string; type: string }[]>;
        load: (themeId: string) => Promise<{
          name: string;
          type: string;
          colors: Record<string, string>;
        } | null>;
      };
      fonts: {
        install: () => Promise<{
          success: boolean;
          error?: string;
          alreadyInstalled?: boolean;
        }>;
        uninstall: () => Promise<{ success: boolean }>;
        getPath: () => Promise<string | null>;
        getAsBase64: (fontFileName: string) => Promise<string | null>;
      };
      autosave: {
        save: (tabId: string, content: string) => Promise<{ success: boolean }>;
        load: (tabId: string) => Promise<{ content: string | null }>;
        delete: (tabId: string) => Promise<{ success: boolean }>;
      };
      variables: {
        getKeys: () => Promise<string[]>;
        read: () => Promise<Record<string, any>>;
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<boolean>;
        writeVariables: (
          content: string | Record<string, any>,
        ) => Promise<void>;
      };
    };
  }
}

export interface Extension {
  id: string;
  type: "core" | "community";
  name: string;
  description: string;
  author: string;
  version: string;
  enabled: boolean;
  readme: string;
  repo?: string;
  installedPath?: string;
  latestVersion?: string;
  capabilities?: {
    blocks?: {
      owns?: string[];
      allowExtensions?: boolean;
      description?: string;
    };
    slashCommands?: {
      groups?: Array<{
        name: string;
        commands?: string[];
      }>;
    };
    paste?: {
      patterns?: Array<{
        name: string;
        description?: string;
        pattern?: string;
        handles?: string;
      }>;
      blockHandlers?: Array<{
        blockType: string;
        description?: string;
      }>;
    };
    editorActions?: {
      actions?: Array<{
        id: string;
        name: string;
        description?: string;
        icon?: string;
        fileTypes?: string[];
      }>;
      description?: string;
    };
    requestPipeline?: {
      buildHandler?: boolean;
      responseHandler?: boolean;
      description?: string;
    };
  };
  features?: string[];
  dependencies?: any;
}
