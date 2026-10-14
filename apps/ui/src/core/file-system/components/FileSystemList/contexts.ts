import React from "react";
import { NodeApi } from "react-arborist";
import { ExtendedFileTree } from "./types";

export const DragOverContext = React.createContext<{
  dragOverParentId: string | null;
  setDragOverParentId: (id: string | null) => void;
}>({
  dragOverParentId: null,
  setDragOverParentId: () => { },
});

export const TreeActionsContext = React.createContext<{
  expandAllRecursive: (startPath: string) => Promise<void>;
  collapseAllFromFolder: (folderNode: NodeApi<ExtendedFileTree>, options?: { includeSelf?: boolean }) => Promise<void>;
  createFile: (path: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
}>({
  expandAllRecursive: async () => { },
  collapseAllFromFolder: async () => { },
  createFile: async () => { },
  createDirectory: async () => { },
});
