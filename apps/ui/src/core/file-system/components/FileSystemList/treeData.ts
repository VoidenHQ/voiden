import { MutableRefObject } from "react";
import { NodeApi } from "react-arborist";
import { ExtendedFileTree } from "./types";

export function updateTreeData(
  nodes: ExtendedFileTree[],
  parentId: string,
  newNode: ExtendedFileTree,
): ExtendedFileTree[] {
  return nodes.map((node) => {
    if (node.path === parentId) {
      return { ...node, children: [...(node.children || []), newNode] };
    }
    if (node.children) {
      return { ...node, children: updateTreeData(node.children, parentId, newNode) };
    }
    return node;
  });
}

export function removeNodeFromTreeData(
  nodes: ExtendedFileTree[],
  nodeId: string,
): ExtendedFileTree[] {
  return nodes
    .filter((node) => node.id !== nodeId)
    .map((node) => (node.children ? { ...node, children: removeNodeFromTreeData(node.children, nodeId) } : node));
}

export function injectChildren(
  nodes: ExtendedFileTree[],
  targetPath: string,
  children: ExtendedFileTree[],
): ExtendedFileTree[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children: children as ExtendedFileTree[], lazy: false };
    }
    if (node.children && node.children.length > 0) {
      return { ...node, children: injectChildren(node.children, targetPath, children) };
    }
    return node;
  });
}

/**
 * Inject several folders' freshly fetched children in one pass, parents first.
 * Injecting a parent replaces its whole subtree with unloaded child folders, so
 * a parent applied after one of its children would wipe that child's contents
 * and the open folder would show empty until it reloads.
 */
export function injectChildrenBatch(
  nodes: ExtendedFileTree[],
  results: { dirPath: string; children: ExtendedFileTree[] }[],
): ExtendedFileTree[] {
  const depth = (p: string) => p.split(/[/\\]/).length;
  return [...results]
    .sort((a, b) => depth(a.dirPath) - depth(b.dirPath))
    .reduce((updated, { dirPath, children }) => injectChildren(updated, dirPath, children), nodes);
}

export function getParentPath(path: string): string {
  if (!path) return "";
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (sep === -1) return "";
  return path.slice(0, sep);
}

export function findNodeByPath(
  nodes: ExtendedFileTree[],
  targetPath: string,
): ExtendedFileTree | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return undefined;
}

export function ensureFolderExpanded(
  folderNode: NodeApi<ExtendedFileTree> | null | undefined,
  path: string,
  expandedDirsRef: MutableRefObject<Set<string>>,
) {
  if (!folderNode) return;
  if (!folderNode.isOpen) {
    folderNode.open();
    expandedDirsRef.current.add(path);
  }
}

export function removeNodeByPath(
  nodes: ExtendedFileTree[],
  targetPath: string,
): ExtendedFileTree[] {
  return nodes
    .filter((node) => node.path !== targetPath)
    .map((node) => (node.children ? { ...node, children: removeNodeByPath(node.children, targetPath) } : node));
}
