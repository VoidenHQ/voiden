import { mergeAttributes, Node, NodeViewProps } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import React from "react";
import { Sparkles } from "lucide-react";
import { validatePythonScript, validateScript, validateShellScript } from "../lib/validateScript";

/**
 * Basic JavaScript prettifier that fixes indentation based on braces/brackets.
 * Not as thorough as prettier but handles common formatting needs.
 */
const prettifyJavaScript = (code: string): string => {
  try {
    if (!code || !code.trim()) return code;

    const lines = code.split('\n');
    let indentLevel = 0;
    const indentStr = '  ';
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) {
        result.push('');
        continue;
      }

      // Decrease indent for lines starting with closing braces/brackets
      const leadingClosers = line.match(/^[\}\]\)]+/);
      if (leadingClosers) {
        indentLevel = Math.max(0, indentLevel - leadingClosers[0].length);
      }

      result.push(indentStr.repeat(indentLevel) + line);

      // Count net openers/closers on this line (ignoring those in strings)
      let netOpen = 0;
      let inString: string | null = null;
      let escaped = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (inString) {
          if (ch === inString) inString = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          inString = ch;
          continue;
        }
        // Skip single-line comments
        if (ch === '/' && j + 1 < line.length && (line[j + 1] === '/' || line[j + 1] === '*')) break;
        if (ch === '{' || ch === '[' || ch === '(') netOpen++;
        if (ch === '}' || ch === ']' || ch === ')') netOpen--;
      }
      indentLevel = Math.max(0, indentLevel + netOpen);
    }

    return result.join('\n');
  } catch {
    return code;
  }
};

/**
 * Lightweight Python prettifier.
 * Keeps structure intact while normalizing indentation and spacing.
 */
const prettifyPython = (code: string): string => {
  try {
    if (!code || !code.trim()) return code;

    const lines = code.split('\n');
    const result: string[] = [];
    const indentUnit = '    ';

    for (const rawLine of lines) {
      // Preserve fully empty lines.
      if (!rawLine.trim()) {
        result.push('');
        continue;
      }

      // Normalize line-end whitespace.
      const line = rawLine.replace(/\s+$/g, '');

      // Convert leading tabs/spaces to normalized 4-space indentation.
      const leading = line.match(/^\s*/)?.[0] ?? '';
      const content = line.slice(leading.length).replace(/\s+$/g, '');
      const spaces = leading.replace(/\t/g, indentUnit).length;
      const indentLevel = Math.floor(spaces / 4);

      result.push(`${indentUnit.repeat(indentLevel)}${content}`);
    }

    return result.join('\n');
  } catch {
    return code;
  }
};

/**
 * Factory to create a script block node (used for both pre_script and post_script).
 *
 * @param config.name - TipTap node name (e.g. "pre_script" or "post_script")
 * @param config.tag - HTML tag name (e.g. "pre-script" or "post-script")
 * @param config.title - Block header title (e.g. "PRE-REQUEST SCRIPT")
 * @param config.defaultBody - Default script content for new blocks
 * @param NodeViewWrapper - From context.ui.components
 * @param CodeEditor - From context.ui.components
 * @param RequestBlockHeader - From context.ui.components
 * @param openFile - From context.project.openFile
 * @param HelpContent - Optional help component
 */
export const createScriptNode = (
  config: {
    name: string;
    tag: string;
    title: string;
    defaultBody: string;
  },
  NodeViewWrapper: any,
  CodeEditor: any,
  RequestBlockHeader: any,
  openFile?: (relativePath: string) => Promise<void>,
  HelpContent?: React.ReactNode,
) => {
  const ScriptNodeView = (props: NodeViewProps) => {
    const [shouldAutofocus, setShouldAutofocus] = React.useState(false);
    const isImported = !!props.node.attrs.importedFrom;
    const language = props.node.attrs.language || 'javascript';
    // Stable validate function for CodeMirror linter (language-aware)
    const scriptValidateFn = React.useMemo(() => {
      if (language === 'javascript') {
        return (content: string) => validateScript(content);
      }
      if (language === 'python') {
        return (content: string) => validatePythonScript(content);
      }
      if (language === 'shell') {
        return (content: string) => validateShellScript(content);
      }
      return undefined;
    }, [language]);

    React.useEffect(() => {
      if (!isImported && props.editor.storage[config.name]?.shouldFocusNext) {
        setShouldAutofocus(true);
        const timer = setTimeout(() => {
          if (props.editor.storage[config.name]) {
            props.editor.storage[config.name].shouldFocusNext = false;
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [props.editor.storage[config.name]?.shouldFocusNext, isImported]);

    return (
      <NodeViewWrapper>
        <div className="my-2 border border-border">
          <RequestBlockHeader
            title={config.title}
            withBorder={false}
            editor={props.editor}
            importedDocumentId={props.node.attrs.importedFrom}
            openFile={openFile}
            helpContent={HelpContent}
          />
          <div className="flex items-center justify-end gap-2 px-2 py-1 border-b border-[rgba(0,0,0,0.1)]" contentEditable={false}>
            {!isImported && props.editor.isEditable && (language === 'javascript' || language === 'python') && /* no prettify for shell */ (
              <button
                className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono text-comment hover:text-text transition-colors opacity-60 hover:opacity-100"
                onClick={() => {
                  try {
                    const currentValue = props.node.attrs.body || '';
                    const prettified =
                      language === 'python'
                        ? prettifyPython(currentValue)
                        : prettifyJavaScript(currentValue);
                    props.updateAttributes({ body: prettified });
                  } catch {}
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                <Sparkles size={11} />
                <span>PRETTIFY</span>
              </button>
            )}
            <select
              value={language}
              onChange={(e) => props.updateAttributes({ language: e.target.value })}
              disabled={isImported || !props.editor.isEditable}
              className="text-xs bg-transparent text-comment hover:text-text focus:text-text border-none rounded px-1 py-0.5 opacity-60 hover:opacity-100 focus:opacity-100 cursor-pointer focus:outline-none font-mono"
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="shell">Shell (bash)</option>
            </select>
          </div>
          <div style={{ height: 'auto' }}>
            <CodeEditor
              tiptapProps={props}
              lang={language}
              showReplace={false}
              autofocus={shouldAutofocus}
              readOnly={isImported}
              validateFn={scriptValidateFn}
            />
          </div>
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: config.name,
    group: "block",
    content: "",
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        body: {
          default: config.defaultBody,
          parseHTML: (element: HTMLElement) => {
            const codeElement = element.querySelector("code");
            return codeElement?.textContent || element.textContent || config.defaultBody;
          },
          renderHTML: () => {
            // Avoid rendering multiline script body as an HTML attribute.
            return {};
          },
        },
        language: {
          default: 'javascript',
          parseHTML: (element: HTMLElement) => {
            return element.getAttribute('data-language') || 'javascript';
          },
          renderHTML: (attributes: { language?: string }) => ({
            'data-language': attributes.language || 'javascript',
          }),
        },
        importedFrom: {
          default: undefined,
        },
      };
    },

    parseHTML() {
      return [
        {
          tag: config.tag,
          preserveWhitespace: "full",
          getAttrs: (element: HTMLElement) => {
            const codeElement = element.querySelector("code");
            const body = codeElement?.textContent || element.textContent || "";
            return {
              language: element.getAttribute('data-language') || 'javascript',
              body,
            };
          },
        },
      ];
    },

    renderHTML({ node, HTMLAttributes }: { node: any; HTMLAttributes: Record<string, any> }) {
      const { language, body } = node.attrs;
      return [
        config.tag,
        mergeAttributes(HTMLAttributes, {
          'data-language': language || 'javascript',
        }),
        [
          'code',
          {
            class: language ? `language-${language}` : undefined,
          },
          body || '',
        ],
      ];
    },

    addStorage() {
      return {
        shouldFocusNext: true,
      };
    },

    addNodeView() {
      return ReactNodeViewRenderer(ScriptNodeView);
    },

    addKeyboardShortcuts() {
      return {
        Backspace: ({ editor }: { editor: any }) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === config.name) {
            return true;
          }
          return false;
        },
        Delete: ({ editor }: { editor: any }) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === config.name) {
            return true;
          }
          return false;
        },
      };
    },
  });
};
