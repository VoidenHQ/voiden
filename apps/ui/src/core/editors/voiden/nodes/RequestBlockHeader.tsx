import React, { useState } from "react";
import { Editor } from "@tiptap/react";
import { ExternalLink, HelpCircle } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { getBlockDocsUrl } from "@/plugins";

function getInheritedFolderName(importedDocumentId: string): string | null {
  const normalized = importedDocumentId.replace(/\\/g, "/");
  if (!normalized.endsWith("/.voiden-inherited.void")) return null;
  const parts = normalized.split("/");
  return parts[parts.length - 2] ?? null;
}

function getInheritedFolderName(importedDocumentId: string): string | null {
  const normalized = importedDocumentId.replace(/\\/g, "/");
  if (!normalized.endsWith("/.voiden-inherited.void")) return null;
  const parts = normalized.split("/");
  return parts[parts.length - 2] ?? null;
}

export const RequestBlockHeader = ({
  title,
  withBorder,
  editor,
  actions,
  importedDocumentId,
  docsUrl,
  blockType,
  blockAttributes,
  helpContent,
  openFile,
}: {
  title: string;
  withBorder?: boolean;
  editor: Editor;
  importedDocumentId?: string;
  actions?: React.ReactNode;
  /** URL to the canonical docs page for this block. Opens in the system browser when clicked. */
  docsUrl?: string;
  /** The registered block type name. If passed, it will be used to look up the docsUrl from the plugin registry. */
  blockType?: string;
  /** Attributes of the current block node, used for dynamic docsUrl resolution. */
  blockAttributes?: Record<string, any>;
  /** Optional inline help content shown in a tooltip popover. */
  helpContent?: React.ReactNode;
  /** Optional callback to open a file from within the block (used by scripting plugin). */
  openFile?: (relativePath: string) => Promise<void>;
}) => {
  const [helpOpen, setHelpOpen] = useState(false);

  const resolvedDocsUrl = blockType ? (getBlockDocsUrl(blockType, blockAttributes) ?? docsUrl) : docsUrl;

  const handleOpenDocs = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!resolvedDocsUrl) return;
    try {
      (window as any).electron?.utils?.openExternalUrl(resolvedDocsUrl);
    } catch {
      // Fallback: try ipcRenderer send via ipc bridge
      (window as any).electron?.ipc?.invoke("open-external", resolvedDocsUrl);
    }
  };

  const inheritedFolder = importedDocumentId ? getInheritedFolderName(importedDocumentId) : null;
  return (
    <div
      className="h-8 px-3 flex items-center w-full border-b"
      style={{ backgroundColor: 'var(--block-header-bg)', borderColor: 'var(--ui-line)' }}
      contentEditable={false}
    >
      <div className="flex items-center gap-2 flex-1">
        <span
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: 'var(--syntax-tag)' }}
        >
          {title}
        </span>
        {inheritedFolder && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: 'var(--syntax-comment)', backgroundColor: 'var(--ui-line)' }}
          >
            inherited from {inheritedFolder}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {actions}

        {helpContent && (
          <Tooltip.Provider delayDuration={0}>
            <Tooltip.Root open={helpOpen} onOpenChange={setHelpOpen}>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  className="flex items-center justify-center w-5 h-5 rounded opacity-40 hover:opacity-80 transition-opacity"
                  style={{ color: 'var(--syntax-tag)', cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); setHelpOpen(o => !o); }}
                  aria-label="Help"
                >
                  <HelpCircle size={12} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="bottom"
                  align="end"
                  className="z-50 max-w-xs rounded-md border p-3 shadow-lg text-sm"
                  style={{
                    backgroundColor: 'var(--bg-panel, #1e1e1e)',
                    borderColor: 'var(--ui-line)',
                    color: 'var(--text)',
                  }}
                  onPointerDownOutside={() => setHelpOpen(false)}
                >
                  {helpContent}
                  <Tooltip.Arrow style={{ fill: 'var(--ui-line)' }} />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        )}

        {resolvedDocsUrl && (
          <Tooltip.Provider delayDuration={300}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  className="flex items-center justify-center w-5 h-5 rounded opacity-40 hover:opacity-80 transition-opacity"
                  style={{ color: 'var(--syntax-tag)', cursor: 'pointer' }}
                  onClick={handleOpenDocs}
                  aria-label="Open documentation"
                >
                  <ExternalLink size={12} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="bottom"
                  align="end"
                  className="z-50 rounded px-2 py-1 text-xs shadow-md"
                  style={{
                    backgroundColor: 'var(--bg-panel, #1e1e1e)',
                    borderColor: 'var(--ui-line)',
                    color: 'var(--text)',
                    border: '1px solid var(--ui-line)',
                  }}
                >
                  Open documentation
                  <Tooltip.Arrow style={{ fill: 'var(--ui-line)' }} />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        )}
      </div>
    </div>
  );
};
