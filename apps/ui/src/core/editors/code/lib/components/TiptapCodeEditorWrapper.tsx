import { RequestBlockHeader } from "@/core/editors/voiden/nodes/RequestBlockHeader";
import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { CodeEditor } from "./CodeEditor.tsx";

export type CodeNodeViewRendererProps = NodeViewProps & {
  title: string;
  lang: string;
  readOnly?: boolean;
  updateAttributes: (attrs: { body: string }) => void;
  actions?: React.ReactNode;
  autofocus?: boolean;
};

export const TiptapCodeEditorWrapper = (props: CodeNodeViewRendererProps) => {
  // Get environment variable keys (secure - no values exposed to UI)
  return (
    <NodeViewWrapper contentEditable={false} className="border border-border my-4">
      <RequestBlockHeader
        title={props.title}
        // sourceDocument={sourceDocument}
        importedDocumentId={props.node.attrs.importedFrom}
        editor={props.editor}
        actions={props.actions}
        blockType={props.node.type.name}
        blockAttributes={props.node.attrs}
      />

      <CodeEditor
        tiptapProps={props}
        readOnly={Boolean(props.node.attrs.importedFrom) || props.editor.isEditable === false}
        autofocus={props.autofocus}
        lang={props.lang}
      />
    </NodeViewWrapper>
);
};
