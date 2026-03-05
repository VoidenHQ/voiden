import { Decoration, DecorationSet, EditorView, Extension, Prec, Range, ViewPlugin, ViewUpdate } from "@uiw/react-codemirror";
import { dispatchVariableClick, findEnvVariableEl, createCursorHandlers, isModKey } from "@/core/editors/variableClickHelpers";

// Style classes for highlighting - uses CSS variables for theme support
const styleClasses = {
  green: "font-mono rounded-sm font-medium text-base variable-highlight-valid",
  red: "font-mono rounded-sm font-medium text-base variable-highlight-invalid",
  cyan: "font-mono rounded-sm font-medium text-base variable-highlight-faker",
};

/**
 * Applies highlighting to all {{variable}} tokens in the document.
 */
function applyHighlighting(view: EditorView, envData: Record<string, string>, processData: Record<string, string>): DecorationSet {
  const marks: Array<Range<Decoration>> = [];
  const documentText = view.state.doc.toString();
  const regex = /\{\{(.*?)\}\}/g;
  let match;

  while ((match = regex.exec(documentText)) !== null) {
    const { index: start, 0: matchedText } = match;
    const end = start + matchedText.length;
    const variableName = match[1].trim();

    const isFakerVariable = variableName.startsWith('$faker');
    const isProcessVariable = variableName.startsWith('process');

    let className: string;
    const attributes: Record<string, string> = {
      "data-variable": variableName,
      "data-variable-type": isFakerVariable ? "faker" : isProcessVariable ? "process" : "env",
    };

    if (isFakerVariable) {
      className = styleClasses.cyan;
    } else if (isProcessVariable) {
      const processKey = variableName.replace('process.', '');
      const hasKey = Object.prototype.hasOwnProperty.call(processData, processKey);
      className = hasKey ? styleClasses.green : styleClasses.red;
      if (hasKey) {
        attributes["data-var-value"] = processData[processKey];
      }
    } else {
      const hasKey = Object.prototype.hasOwnProperty.call(envData, variableName);
      className = hasKey ? styleClasses.green : styleClasses.red;
      if (hasKey) {
        attributes["data-var-value"] = envData[variableName];
      }
    }

    marks.push(Decoration.mark({ class: className, attributes }).range(start, end));
  }

  return Decoration.set(marks);
}

/**
 * Creates the CodeMirror highlighting plugin for environment and process variables.
 */
export function createHighlightPlugin(envData: Record<string, string> = {}, processData: Record<string, string> = {}): Extension {
  const highlightView = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = applyHighlighting(view, envData, processData);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = applyHighlighting(update.view, envData, processData);
        }
      }
    },
    { decorations: (view) => view.decorations },
  );

  let cursorHandlers: ReturnType<typeof createCursorHandlers> | null = null;

  const clickHandler = EditorView.domEventHandlers({
    click(event: MouseEvent, view: EditorView) {
      if (!isModKey(event)) return false;
      const variableEl = findEnvVariableEl(event);
      if (!variableEl) return false;
      dispatchVariableClick(variableEl, view.dom);
      event.preventDefault();
      return true;
    },
    mousemove(event: MouseEvent, view: EditorView) {
      if (!cursorHandlers) cursorHandlers = createCursorHandlers(() => view.dom);
      cursorHandlers.mousemove(event);
      return false;
    },
    keydown(event: KeyboardEvent, view: EditorView) {
      if (!cursorHandlers) cursorHandlers = createCursorHandlers(() => view.dom);
      cursorHandlers.keydown(event);
      return false;
    },
    keyup(event: KeyboardEvent, view: EditorView) {
      if (!cursorHandlers) cursorHandlers = createCursorHandlers(() => view.dom);
      cursorHandlers.keyup(event);
      return false;
    },
  });

  return Prec.highest([highlightView, clickHandler]);
}
