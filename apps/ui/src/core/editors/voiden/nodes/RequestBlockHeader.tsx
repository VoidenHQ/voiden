import React, { useState } from "react";
import { Editor } from "@tiptap/react";
import { HelpCircle } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";

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
  helpContent,
  openFile,
}: {
  title: string;
  withBorder?: boolean;
  editor: Editor;
  importedDocumentId?: string;
  actions?: React.ReactNode;
  /** Optional inline help content shown in a tooltip popover. */
  helpContent?: React.ReactNode;
  /** Optional callback to open a file from within the block (used by scripting plugin). */
  openFile?: (relativePath: string) => Promise<void>;
}) => {
  const [helpOpen, setHelpOpen] = useState(false);

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
      </div>
    </div>
  );
};
