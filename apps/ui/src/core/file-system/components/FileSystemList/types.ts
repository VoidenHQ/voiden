import { FileTree } from "@/types";

export type GitStatus = {
  working_dir?: string;
  index?: string;
};

export type ExtendedFileTree = FileTree & {
  id: string;
  parent?: string;
  isTemporary?: boolean;
  fileKind?: "file" | "void" | undefined;
  children?: ExtendedFileTree[];
  lazy?: boolean;
  git?: GitStatus;
  aggregatedGitStatus?: GitStatus;
};
