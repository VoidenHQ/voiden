import { Editor } from "@tiptap/react";

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
      </div>

      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
};
