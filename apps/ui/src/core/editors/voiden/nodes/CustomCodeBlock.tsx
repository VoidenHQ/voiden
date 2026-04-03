import { mergeAttributes, NodeViewProps } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { CodeEditor } from "@/core/editors/code/lib/components/CodeEditor";
import { RequestBlockHeader } from "@/core/editors/voiden/nodes/RequestBlockHeader";
import { useSettings } from "@/core/settings/hooks";

// CodeMirror default line height in pixels (font-size 14px × 1.5)
const CM_LINE_HEIGHT_PX = 21;

const CodeBlockView = (props: NodeViewProps) => {
  const { node, updateAttributes, editor } = props;
  const body = node.attrs.body || "";
  const language = node.attrs.language || "plaintext";
  const isEditable = editor.isEditable;
  const { settings } = useSettings();

  const maxLines = settings?.editor?.code_block_max_lines ?? 50;
  const maxHeightStyle = maxLines === 0
    ? undefined
    : { maxHeight: `${maxLines * CM_LINE_HEIGHT_PX}px`, overflowY: 'auto' as const };

  return (
    <NodeViewWrapper className="code-block-wrapper not-prose my-2">
      <div className="[&_.cm-editor.cm-focused]:outline-none [&_.cm-editor]:outline-none">
        {/* Language selector */}
        <RequestBlockHeader
          title="CODE BLOCK"
          withBorder={false}
          editor={editor}
        />
        <div className="px-2 flex items-center justify-end border-b !border-solid !border-[rgba(0,0,0,0.2)] bg-panel">
          <select
            value={language}
            onChange={(e) => updateAttributes({ language: e.target.value })}
            disabled={!isEditable}
            className="text-xs bg-transparent text-comment hover:text-text focus:text-text border-none rounded px-2 py-1 opacity-60 hover:opacity-100 focus:opacity-100 transition-all cursor-pointer focus:outline-none font-mono"
            contentEditable={false}
          >
            <option value="plaintext">Plain Text</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="json">JSON</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
            <option value="c">C</option>
            <option value="csharp">C#</option>
            <option value="php">PHP</option>
            <option value="ruby">Ruby</option>
            <option value="go">Go</option>
            <option value="rust">Rust</option>
            <option value="sql">SQL</option>
            <option value="shell">Shell</option>
            <option value="bash">Bash</option>
            <option value="yaml">YAML</option>
            <option value="markdown">Markdown</option>
            <option value="xml">XML</option>
          </select>
        </div>

        {/* Code editor */}
        <div contentEditable={false} style={{ height: 'auto', ...maxHeightStyle }}>
          <CodeEditor
            lang={language}
            readOnly={!isEditable}
            showReplace={false}
            autofocus={!body && isEditable}
            tiptapProps={{
              ...props,
              title: "",
              lang: language,
              updateAttributes,
            }}
          />
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export const CustomCodeBlock = CodeBlock.extend({
  // This node has no content - everything is stored in attrs.body
  content: "",

  addAttributes() {
    return {
      language: {
        default: "plaintext",
        parseHTML: (element) => {
          return element.getAttribute("data-language") ||
                 element.querySelector("code")?.getAttribute("class")?.replace("language-", "") ||
                 "plaintext";
        },
        renderHTML: (attributes) => {
          return {
            "data-language": attributes.language,
          };
        },
      },
      body: {
        default: "",
        parseHTML: (element) => {
          const codeElement = element.querySelector("code");
          return codeElement?.textContent || element.textContent || "";
        },
        renderHTML: () => {
          // Don't render body as HTML attribute
          return {};
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs: (node) => {
          if (typeof node === "string") return {};
          const element = node as HTMLElement;
          const codeElement = element.querySelector("code");
          return {
            language: element.getAttribute("data-language") ||
                     codeElement?.getAttribute("class")?.replace("language-", "") ||
                     "plaintext",
            body: codeElement?.textContent || element.textContent || "",
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { language, body } = node.attrs;
    return [
      "pre",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "code-block",
        "data-language": language,
      }),
      [
        "code",
        {
          class: language ? `language-${language}` : undefined,
        },
        body || "",
      ],
    ];
  },
});
