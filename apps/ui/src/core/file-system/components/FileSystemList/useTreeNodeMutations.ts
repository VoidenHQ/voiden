import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NodeApi, TreeApi } from "react-arborist";
import { ExtendedFileTree } from "./types";
import { getParentPath } from "./treeData";

type CreateResult = { name: string; path: string };

interface UseTreeNodeMutationsArgs {
  node: NodeApi<ExtendedFileTree>;
  setError: (msg: string | null) => void;
  refreshDir: (dirPath: string) => Promise<void>;
  expandedDirsRef: React.MutableRefObject<Set<string>>;
  treeRef: React.RefObject<TreeApi<ExtendedFileTree>>;
  onFolderToggle: (node: NodeApi<ExtendedFileTree>) => void;
}

async function addAndActivateTab(result: CreateResult): Promise<string | null> {
  const newTab = {
    id: crypto.randomUUID(),
    type: "document" as const,
    title: result.name,
    source: result.path,
    directory: null,
  };
  const response = await window.electron?.state.addPanelTab("main", newTab);
  return response?.tabId ?? null;
}

export function useTreeNodeMutations({
  node,
  setError,
  refreshDir,
  expandedDirsRef,
  treeRef,
  onFolderToggle,
}: UseTreeNodeMutationsArgs) {
  const queryClient = useQueryClient();

  // Shared success/error for the file-create flows (regular + .void).
  const onCreateFileSuccess = (result: CreateResult) => {
    node.submit(result.name);
    refreshDir(node.data.parent!);
    queryClient.invalidateQueries({ queryKey: ["env"] });
  };
  const onCreateFileError = (error: Error) => {
    setError(error.message || "Error creating file");
    node.edit();
  };
  const runFileCreate = async (
    create: (parent: string, name: string) => Promise<CreateResult | undefined>,
    newName: string,
  ): Promise<CreateResult> => {
    const result = await create(node.data.parent!, newName);
    if (!result) throw new Error("File creation failed");
    const tabId = await addAndActivateTab(result);
    if (tabId) {
      await window.electron?.state.activatePanelTab("main", tabId);
      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
    }
    return result;
  };

  const createFileMutation = useMutation({
    mutationFn: (newName: string) =>
      runFileCreate(
        (parent, name) => window.electron!.files.create(parent, name) as Promise<CreateResult | undefined>,
        newName,
      ),
    onSuccess: onCreateFileSuccess,
    onError: onCreateFileError,
  });

  const createVoidFileMutation = useMutation({
    mutationFn: (newName: string) =>
      runFileCreate(
        (parent, name) => window.electron!.files.createVoid(parent, name) as Promise<CreateResult | undefined>,
        newName,
      ),
    onSuccess: onCreateFileSuccess,
    onError: onCreateFileError,
  });

  const createDirectoryMutation = useMutation({
    mutationFn: async (newName: string) => {
      const result = await window.electron?.files.createDirectory(node.data.parent!, newName);
      if (!result) throw new Error("Directory creation failed");
      return result;
    },
    onSuccess: (result) => {
      node.submit(result);
      refreshDir(node.data.parent!);
    },
    onError: (error: Error) => {
      setError(error.message || "Error creating directory");
      node.edit();
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ oldPath, newName }: { oldPath: string; newName: string }) => {
      const result = await window.electron?.state.renameFile(oldPath, newName);
      if (!result?.success) {
        throw new Error(result?.error || "Renaming failed");
      }
      return result;
    },
    onSuccess: async (result, { oldPath, newName }) => {
      node.submit(newName);

      const wasFolderOpen = node.data.type === "folder" && node.isOpen;
      const newPath = result.data.path;
      const parentPath = node.data.parent || getParentPath(oldPath);

      if (parentPath) {
        if (wasFolderOpen) {
          expandedDirsRef.current.add(newPath);
        }
        if (node.data.type === "folder") {
          expandedDirsRef.current.delete(oldPath);
        }

        await refreshDir(parentPath);

        // After refresh, re-open the renamed folder via onFolderToggle (expandLazyNode)
        // so children fetch from disk — the renamed folder is a lazy stub after refresh.
        if (wasFolderOpen) {
          setTimeout(() => {
            const renamedNode = treeRef.current?.get(newPath);
            if (renamedNode && !renamedNode.isOpen) {
              onFolderToggle(renamedNode);
            }
          }, 0);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["panel:tabs"] });
      queryClient.invalidateQueries({ queryKey: ["tab:content"] });
      queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent"] });
      queryClient.invalidateQueries({ queryKey: ["file:exists"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });
    },
    onError: (error: Error) => {
      setError(error.message || "Error renaming file");
      node.edit();
    },
  });

  const dropFilesMutation = useMutation({
    mutationFn: async ({ files, targetPath }: { files: File[]; targetPath: string }) => {
      const results = [];
      for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const result = await window.electron?.files.drop(targetPath, file.name, uint8Array);
        if (!result) throw new Error(`Failed to upload ${file.name}`);
        results.push(result);
      }
      return results;
    },
    onSuccess: (_, { targetPath }) => {
      refreshDir(targetPath);
      queryClient.invalidateQueries({ queryKey: ["env"] });
    },
    onError: (error: Error) => {
      console.error("File drop error:", error);
      setError(error.message || "Error drop files");
    },
  });

  return {
    createFileMutation,
    createVoidFileMutation,
    createDirectoryMutation,
    renameMutation,
    dropFilesMutation,
  };
}
