import { JSONContent } from "@tiptap/core";
import { getQueryClient } from "@/main";
import { parseMarkdown } from "@/core/editors/voiden/markdownConverter";

// Block types that are request-instance-specific and must not bleed across from
// inherited files (they would duplicate or conflict with the request's own nodes).
const NON_INHERITABLE_BLOCK_TYPES = new Set([
  "request-separator",
  "linkedBlock",
  "linkedFile",
]);

/**
 * Resolves and injects blocks from ancestor .voiden-inherited files into the
 * document JSON using REPLACEMENT semantics:
 *
 * - A block type already present in the child is never overridden — the child
 *   always wins completely (no merging of individual keys).
 * - Among inherited ancestors, the closest one wins: if both api/ and workspace/
 *   define a headers-table, only api/'s version is used.
 * - The chain is workspace-root → child; we iterate in reverse (child-first) so
 *   closer ancestors are seen first and block the workspace-level version.
 */
export async function injectInheritedBlocks(
  doc: JSONContent,
  filePath: string,
  schema: any,
): Promise<JSONContent> {
  if (!window.electron?.files?.resolveInheritedChain) return doc;

  const queryClient = getQueryClient();
  const projects = queryClient.getQueryData<{ activeProject: string }>(["projects"]);
  const workspaceRoot = projects?.activeProject;
  if (!workspaceRoot) return doc;

  let chain: string[];
  try {
    chain = await window.electron.files.resolveInheritedChain(filePath, workspaceRoot);
  } catch {
    return doc;
  }
  if (!chain.length) return doc;

  // Block types the child already owns — these are never overridden.
  // Exception: an auth node with authType "inherit" or "none" explicitly defers
  // to an ancestor, so treat it as absent and allow the inherited auth in.
  const localBlockTypes = new Set(
    (doc.content ?? [])
      .filter((b) => {
        if (b.type === "auth") {
          const t = b.attrs?.authType;
          return Boolean(t) && t !== "inherit" && t !== "none";
        }
        return true;
      })
      .map((b) => b.type)
      .filter(Boolean) as string[]
  );

  const inheritedBlocks: JSONContent[] = [];
  // Track which types have already been filled in by a closer ancestor so a
  // further-away ancestor cannot also inject the same type.
  const claimedTypes = new Set<string>();

  const markInherited = (inheritedPath: string) => (node: JSONContent): JSONContent => ({
    ...node,
    attrs: { ...node.attrs, importedFrom: inheritedPath },
    content: node.content?.map(markInherited(inheritedPath)),
  });

  // Iterate closest ancestor first so it gets first claim on each block type.
  for (const inheritedPath of [...chain].reverse()) {
    let markdown: string | null = null;
    try {
      markdown = await window.electron.files.read(inheritedPath);
    } catch {
      continue;
    }
    if (!markdown) continue;

    let inheritedDoc: JSONContent | null = null;
    try {
      inheritedDoc = parseMarkdown(markdown, schema);
    } catch {
      continue;
    }
    if (!inheritedDoc?.content) continue;

    for (const block of inheritedDoc.content) {
      if (
        block.type &&
        !NON_INHERITABLE_BLOCK_TYPES.has(block.type) &&
        !localBlockTypes.has(block.type) &&   // child already has this block → skip
        !claimedTypes.has(block.type)          // a closer ancestor already provided it → skip
      ) {
        inheritedBlocks.push(markInherited(inheritedPath)(block));
        claimedTypes.add(block.type);
      }
    }
  }

  if (!inheritedBlocks.length) return doc;

  return {
    ...doc,
    content: [...(doc.content ?? []), ...inheritedBlocks],
  };
}
