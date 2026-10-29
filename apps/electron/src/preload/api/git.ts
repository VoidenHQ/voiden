import { ipcRenderer } from "electron";

export const gitApi = {
  getBranches: () => ipcRenderer.invoke("git:getBranches"),
  checkout: (projectPath: string, branch: string) => ipcRenderer.invoke("git:checkout", projectPath, branch),
  createBranch: (projectPath: string, branch: string) => ipcRenderer.invoke("git:createBranch", projectPath, branch),
  createBranchFrom: (projectPath: string, branch: string, fromBranch: string) => ipcRenderer.invoke("git:createBranchFrom", projectPath, branch, fromBranch),
  updateGitignore: (filePatterns: string | string[], rootDir?: string) =>ipcRenderer.invoke("git:updateGitignore", filePatterns, rootDir),
  diffBranches: (baseBranch: string, compareBranch: string, repo?: string | null) => ipcRenderer.invoke("git:diffBranches", baseBranch, compareBranch, repo),
  // `repo` pins a call to the repo a diff/conflict tab was opened from; omitted, the selected repo is used.
  diffFile: (baseBranch: string, compareBranch: string, filePath: string, repo?: string | null) => ipcRenderer.invoke("git:diffFile", baseBranch, compareBranch, filePath, repo),
  getFileAtBranch: (branch: string, filePath: string, repo?: string | null) => ipcRenderer.invoke("git:getFileAtBranch", branch, filePath, repo),
  getFileBlob: (ref: string | null, filePath: string, repo?: string | null) => ipcRenderer.invoke("git:getFileBlob", ref, filePath, repo),
  resolveBinaryConflict: (file: string, side: "current" | "incoming", repo?: string | null) => ipcRenderer.invoke("git:resolveBinaryConflict", file, side, repo),
  getRepoRoot: (repo?: string | null) => ipcRenderer.invoke("git:getRepoRoot", repo),
  listRepos: (refresh?: boolean): Promise<{
    repos: { path: string; name: string; relativePath: string; branch: string | null }[];
    selected: string | null;
  }> => ipcRenderer.invoke("git:listRepos", refresh),
  selectRepo: (repo: string) => ipcRenderer.invoke("git:selectRepo", repo),
  getStatus: () => ipcRenderer.invoke("git:getStatus"),
  initialize: () => ipcRenderer.invoke("git:initialize"),
  clone: (repoUrl: string, authOptions?: { token?: string; sshKeyPath?: string; sshPassphrase?: string; useSshAgent?: boolean }) =>
    ipcRenderer.invoke("git:clone", repoUrl, authOptions),
  stage: (files: string[]) => ipcRenderer.invoke("git:stage", files),
  unstage: (files: string[]) => ipcRenderer.invoke("git:unstage", files),
  commit: (message: string) => ipcRenderer.invoke("git:commit", message),
  discard: (files: string[]) => ipcRenderer.invoke("git:discard", files),
  getLog: (limit?: number) => ipcRenderer.invoke("git:getLog", limit),
  getCommitFiles: (commitHash: string) => ipcRenderer.invoke("git:getCommitFiles", commitHash),
  getCommitDetails: (commitHash: string) => ipcRenderer.invoke("git:getCommitDetails", commitHash),
  getAuthorAvatar: (email: string, commitHash: string) => ipcRenderer.invoke("git:getAuthorAvatar", email, commitHash),
  fetchRemote: () => ipcRenderer.invoke("git:fetch"),
  push: () => ipcRenderer.invoke("git:pushBranch"),
  pull: () => ipcRenderer.invoke("git:pull"),
  getRemoteUrl: () => ipcRenderer.invoke("git:getRemoteUrl"),
  setRemoteUrl: (remoteUrl: string) => ipcRenderer.invoke("git:setRemoteUrl", remoteUrl),
  removeRemote: () => ipcRenderer.invoke("git:removeRemote"),
  stash: (message?: string) => ipcRenderer.invoke("git:stash", message),
  stashList: () => ipcRenderer.invoke("git:stashList"),
  stashPop: (index: number) => ipcRenderer.invoke("git:stashPop", index),
  getConflicts: () => ipcRenderer.invoke("git:getConflicts"),
  resolveConflict: (file: string, resolution: 'current' | 'incoming' | 'both', sectionIndex?: number) =>
    ipcRenderer.invoke("git:resolveConflict", file, resolution, sectionIndex),
  getFileContent: (file: string, repo?: string | null) => ipcRenderer.invoke("git:getFileContent", file, repo),
  saveResolvedFile: (file: string, content: string, repo?: string | null) => ipcRenderer.invoke("git:saveResolvedFile", file, content, repo),
  uncommit: () => ipcRenderer.invoke("git:uncommit"),
};
