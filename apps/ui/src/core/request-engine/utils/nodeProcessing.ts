/**
 * Node Processing Utilities
 *
 * Handles processing of editor nodes including:
 * - File link resolution
 * - Linked block resolution
 * - Recursive node traversal
 */

import { useQueryClient } from "@tanstack/react-query";
import { parseMarkdown } from "@/core/editors/voiden/markdownConverter.ts";

// linkedBlock/linkedFile are pointers, not content — never resolve to one of
// these even if its own `uid` happens to collide with the `blockUid` being
// searched for (e.g. a hand-authored file that copied a block's uid onto the
// linkedBlock wrapper instead of generating a fresh one, or a self-referencing
// link into the same file). Matching a pointer node here would hand back a
// linkedBlock as if it were resolved content, which then gets executed as the
// imported block itself instead of failing loudly.
const NON_TARGETABLE_TYPES = new Set(["linkedBlock", "linkedFile"]);

/**
 * Recursively search through an array of nodes for a block with the given uid
 */
const findBlockByUid = (nodes: any[], blockUid: string): any | null => {
  for (const node of nodes) {
    if (node.attrs && node.attrs.uid === blockUid && !NON_TARGETABLE_TYPES.has(node.type)) {
      return node;
    }
    if (node.content && Array.isArray(node.content)) {
      const result = findBlockByUid(node.content, blockUid);
      if (result) return result;
    }
  }
  return null;
};

/**
 * Resolve a linked block from cache or fetch from disk
 */
async function resolveLinkedBlock(
  blockUid: string,
  originalFile: string,
  schema: any,
  queryClient: ReturnType<typeof useQueryClient>
): Promise<any> {
  // Try cache first
  const queryKey = ["voiden-wrapper:blockContent", originalFile, blockUid];
  const cachedData = queryClient.getQueryData(queryKey);

  if (cachedData) {
    return cachedData;
  }

  // Fallback: fetch from disk
  try {
    let sourcePath = originalFile;
    const projects = queryClient.getQueryData<{
      projects: { path: string; name: string }[];
      activeProject: string;
    }>(["projects"]);
    const activeProject = projects?.activeProject;

    if (activeProject) {
      sourcePath = (await window.electron?.utils.pathJoin(activeProject, originalFile)) ?? originalFile;
    }

    const markdown = await window.electron?.voiden.getBlockContent(sourcePath);
    if (!markdown) {
      throw new Error(`No markdown returned for block uid: ${blockUid}`);
    }

    const parsedDoc = parseMarkdown(markdown, schema);
    const referencedBlock = findBlockByUid(parsedDoc?.content ?? [], blockUid);

    if (!referencedBlock) {
      throw new Error(`Block with uid ${blockUid} not found`);
    }

    // Update cache
    queryClient.setQueryData(queryKey, referencedBlock);
    return referencedBlock;
  } catch (error) {
    throw error;
  }
}

/**
 * Attach file data to nodes by resolving file links and linked blocks
 */
export async function attachFileDataToNodes(
  node: any,
  schema: any,
  queryClient: ReturnType<typeof useQueryClient>
): Promise<any> {
  // Handle arrays
  if (Array.isArray(node)) {
    return Promise.all(node.map((child) => attachFileDataToNodes(child, schema, queryClient)));
  }

  // Resolve fileLink nodes
  if (node.type === "fileLink" && node.attrs && node.attrs.filePath) {
    try {
      // Always compute absolute path before sending to electron
      let absolutePath = node.attrs.filePath;

      if (!node.attrs.isExternal) {
        // For internal files, get the active project and join paths
        const projects = queryClient.getQueryData<{
          projects: { path: string; name: string }[];
          activeProject: string;
        }>(["projects"]);
        const activeProject = projects?.activeProject;

        if (activeProject) {
          absolutePath = (await window.electron?.utils.pathJoin(activeProject, node.attrs.filePath)) ?? node.attrs.filePath;
        }
      }

      // Pass absolute path to electron (no need for isExternal flag)
      const files = await window.electron?.files.getFiles([absolutePath], true);

      if (files && Array.isArray(files) && files.length > 0 && files[0].data) {
        const fileBlob = new Blob([files[0].data]);
        const fileObject = new File([fileBlob], files[0].fileName, {
          type: files[0].mimeType || "application/octet-stream",
        });

        return {
          type: "file",
          attrs: {
            enabled: true,
            actualFile: fileObject,
            fileName: files[0].fileName,
            filePath: node.attrs.filePath,
            mimeType: files[0].mimeType,
          },
        };
      } else {
        return node;
      }
    } catch (error) {
      return node;
    }
  }

  // Resolve linkedBlock nodes
  if (node.type === "linkedBlock" && node.attrs && node.attrs.blockUid && node.attrs.originalFile) {
    try {
      const referencedBlock = await resolveLinkedBlock(
        node.attrs.blockUid,
        node.attrs.originalFile,
        schema,
        queryClient
      );

      if (referencedBlock) {
        return attachFileDataToNodes(referencedBlock, schema, queryClient);
      }
      return node;
    } catch (error) {
      return node;
    }
  }

  // Process children recursively
  if (node.content && Array.isArray(node.content)) {
    const newContent = await Promise.all(
      node.content.map((child) => attachFileDataToNodes(child, schema, queryClient))
    );
    return { ...node, content: newContent };
  }

  return node;
}

/**
 * Process entire document to attach file data to all nodes
 */
export async function processFileNodes(
  doc: any,
  schema: any,
  queryClient: ReturnType<typeof useQueryClient>
): Promise<any> {
  return await attachFileDataToNodes(doc, schema, queryClient);
}
