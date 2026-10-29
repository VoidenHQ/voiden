import { createContext, useContext } from "react";

/**
 * The repo a diff or conflict tab was opened from. Tabs stay open while the
 * Source Control panel switches repos, so their git reads are pinned to this;
 * null (outside a tab) means the repo currently selected in the panel.
 */
export const GitRepoContext = createContext<string | null>(null);

export const useTabGitRepo = () => useContext(GitRepoContext);
