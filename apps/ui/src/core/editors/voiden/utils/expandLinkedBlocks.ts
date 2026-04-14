import { JSONContent } from "@tiptap/core";
import { useBlockContentStore } from "@/core/stores/blockContentStore";
import { getQueryClient } from "@/main";
import { parseMarkdown } from "@/core/editors/voiden/markdownConverter";


interface ExpandOptions {
  /** When true, bypass the store cache and always re-read from disk. Use at execution time. */
  forceRefresh?: boolean;
}

/**
 * Recursively expands linkedBlock nodes in editor JSON to their actual content.
 * This allows plugins to process linked blocks as if they were direct blocks.
 *
 * @param json - The editor JSON content (can be a single node or document)
 * @param depth - Current recursion depth (for safety)
 * @param options - Expansion options (e.g., forceRefresh for execution-time guarantee)
 * @returns The JSON with all linkedBlocks expanded to their actual content
 */
export async function expandLinkedBlocks(
  json: JSONContent,
  depth: number = 0,
  options: ExpandOptions = {}
): Promise<JSONContent> {
  // Safety check to prevent infinite recursion
  if (depth > 10) {
    return json;
  }

  // If this is a linkedBlock, resolve it to actual content
  if (json.type === 'linkedBlock') {
    const blockUid = json.attrs?.blockUid;
    const originalFile = json.attrs?.originalFile;

    if (!blockUid) {
      return json;
    }

    try {
      const store = useBlockContentStore.getState();
      let blockContent: any = null;

      // When forceRefresh is false, try the store cache first (faster for UI)
      if (!options.forceRefresh) {
        blockContent = store.blocks[blockUid];
      }

      // If not in store (or forceRefresh), fetch from disk
      if (!blockContent && originalFile) {
        const queryClient = getQueryClient();
        const projects = queryClient.getQueryData<{
          projects: { path: string; name: string }[];
          activeProject: string;
        }>(["projects"]);
        const activeProject = projects?.activeProject;
        const sourcePath = activeProject ? (await window.electron?.utils.pathJoin(activeProject, originalFile)) ?? originalFile : originalFile;
        const fetchedContent = await window.electron?.voiden.getBlockContent(sourcePath);
        if (typeof fetchedContent === "string") {
          // Disk returned raw markdown — fall back to store cache
          blockContent = store.blocks[blockUid];
        } else {
          blockContent = fetchedContent;
        }

        // Cache it for future use
        if (blockContent && !store.blocks[blockUid]) {
          store.setBlock(blockUid, blockContent);
        }
      }

      if (!blockContent || typeof blockContent !== "object") {
        return json;
      }

      // Recursively expand the block content first
      const expandedBlock = await expandLinkedBlocks(blockContent, depth + 1, options);

      // Mark the expanded block AND all its children with importedFrom attribute.
      // This is needed so that child nodes (e.g. json_body inside a request block)
      // are recognized as imported by features like JSON deep merge.
      const markImported = (node: JSONContent): JSONContent => ({
        ...node,
        attrs: {
          ...node.attrs,
          importedFrom: originalFile,
        },
        content: node.content?.map(markImported),
      });

      return markImported(expandedBlock);
    } catch (error) {
      return json;
    }
  }

  // If this node has content array, recursively expand it
  if (json.content && Array.isArray(json.content)) {
    const expandedContent = await Promise.all(
      json.content.map(child => expandLinkedBlocks(child, depth + 1, options))
    );

    return {
      ...json,
      content: expandedContent,
    };
  }

  // No expansion needed
  return json;
}

/** Returns the blocks belonging to the section introduced by the separator with the given uid. */
export function getBlocksForSection(content: any[], sectionUid: string): any[] {
  let inSection = false;
  const blocks: any[] = [];
  for (const node of content) {
    if (node.type === "request-separator") {
      if (inSection) break;
      if (node.attrs?.uid === sectionUid) inSection = true;
    } else if (inSection) {
      blocks.push(node);
    }
  }
  return blocks;
}

/**
 * Expands linkedFile nodes in a document by inlining the referenced file's top-level
 * blocks into the document content array. This must be called BEFORE section splitting
 * so that request-separator nodes from the linked file are visible to the orchestrator.
 *
 * @param doc    - The editor document JSON
 * @param schema - TipTap schema used to parse the linked file's markdown
 * @returns Document with all linkedFile nodes replaced by their constituent blocks
 */
export async function expandLinkedFilesInDoc(
  doc: JSONContent,
  schema?: any,
): Promise<JSONContent> {
  if (!doc.content || !Array.isArray(doc.content)) return doc;
  if (!doc.content.some((n) => n.type === "linkedFile")) return doc;

  const expandedContent: JSONContent[] = [];

  for (const node of doc.content) {
    if (node.type === "linkedFile") {
      const blocks = await fetchLinkedFileBlocks(node, schema);
      expandedContent.push(...blocks);
    } else {
      expandedContent.push(node);
    }
  }

  return { ...doc, content: expandedContent };
}

async function fetchLinkedFileBlocks(node: JSONContent, schema?: any): Promise<JSONContent[]> {
  const originalFile = node.attrs?.originalFile;
  const sectionUid: string | null = node.attrs?.sectionUid ?? null;
  if (!originalFile || !schema) return [];

  try {
    const queryClient = getQueryClient();
    const projects = queryClient.getQueryData<{
      projects: { path: string; name: string }[];
      activeProject: string;
    }>(["projects"]);
    const activeProject = projects?.activeProject;
    const absolutePath = activeProject
      ? ((await window.electron?.utils?.pathJoin(activeProject, originalFile)) ?? originalFile)
      : originalFile;

    const markdown = await window.electron?.voiden?.getBlockContent(absolutePath);
    if (!markdown || typeof markdown !== "string") return [];

    const parsedDoc = parseMarkdown(markdown, schema);
    if (!parsedDoc?.content) return [];

    const markImported = (n: JSONContent): JSONContent => ({
      ...n,
      attrs: { ...n.attrs, importedFrom: originalFile },
      ...(n.content && { content: n.content.map(markImported) }),
    });

    if (sectionUid !== null) {
      // Section-specific import: return only the blocks for that section.
      // The parent document already provides the separator before this linkedFile.
      return getBlocksForSection(parsedDoc.content, sectionUid).map(markImported);
    }

    // Whole-file import: drop a leading request-separator (parent provides it).
    const blocks = parsedDoc.content[0]?.type === "request-separator"
      ? parsedDoc.content.slice(1)
      : parsedDoc.content;

    return blocks.map(markImported);
  } catch {
    return [];
  }
}

/**
 * Expands all linkedBlocks in an editor document's content array.
 * This is the main entry point for processing editor JSON before passing to plugins.
 *
 * @param doc - The editor document JSON
 * @param options - Expansion options. Pass { forceRefresh: true } at execution time
 *                  to guarantee fresh content is read from disk.
 * @returns The document with all linkedBlocks expanded
 */
export async function expandLinkedBlocksInDoc(doc: JSONContent, options: ExpandOptions = {}): Promise<JSONContent> {
  if (!doc.content || !Array.isArray(doc.content)) {
    return doc;
  }

  const startTime = performance.now();

  const expandedContent = await Promise.all(
    doc.content.map(node => expandLinkedBlocks(node, 0, options))
  );

  const duration = performance.now() - startTime;

  return {
    ...doc,
    content: expandedContent,
  };
}
