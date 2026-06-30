import { Editor } from "@tiptap/react";

function getInheritedFolderName(importedDocumentId: string): string | null {
  const normalized = importedDocumentId.replace(/\\/g, "/");
  if (!normalized.endsWith("/.voiden-inherited")) return null;
  const parts = normalized.split("/");
  return parts[parts.length - 2] ?? null;
}

export const RequestBlockHeader = ({
  title,
  withBorder,
  editor,
  actions,
  importedDocumentId,
}: {
  title: string;
  withBorder?: boolean;
  editor: Editor;
  importedDocumentId?: string;
  actions?: React.ReactNode;
}) => {
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

      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
};
