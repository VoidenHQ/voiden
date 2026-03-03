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
 * @param view - CodeMirror editor view
 * @param envKeys - Set of environment variable names (secure - no values exposed)
 */
function applyHighlighting(view: EditorView, envKeys: Set<string>,processKeys:Set<string>): DecorationSet {
  const marks: Array<Range<Decoration>> = [];
  const documentText = view.state.doc.toString();
  const regex = /\{\{(.*?)\}\}/g;
  let match;

  while ((match = regex.exec(documentText)) !== null) {
    const { index: start, 0: matchedText } = match;
    const end = start + matchedText.length;
    const variableName = match[1].trim();

    // Check if it's a faker variable
    const isFakerVariable = variableName.startsWith('$faker');
    const isProcessVariable = variableName.startsWith('process');

    let className: string;
    if (isFakerVariable) {
      // Bright cyan for faker variables
      className = styleClasses.cyan;
    } else if(isProcessVariable){
      //check if variables exists in process variables
      const variable=variableName.replace('process.','');
      className = processKeys.has(variable) ? styleClasses.green : styleClasses.red;
    } else {
      // Check if variable exists in environment
      className = envKeys.has(variableName) ? styleClasses.green : styleClasses.red;
    }

    const decoration = Decoration.mark({
      class: className,
      attributes: {
        "data-variable": variableName,
        "data-variable-type": isFakerVariable ? "faker" : isProcessVariable ? "process" : "env",
      },
    });
    marks.push(decoration.range(start, end));
  }

  return Decoration.set(marks);
}

/**
 * Creates the CodeMirror highlighting plugin for environment variables.
 * @param envKeys - Array of environment variable names (secure - no values exposed)
 * @security Only accepts variable names, never values
 */
export function createHighlightPlugin(envKeys: string[] = [],processVariables:string[]=[]): Extension {
  const envKeysSet = new Set(envKeys);
  const processKeysSet=new Set(processVariables);
  const highlightView = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = applyHighlighting(view, envKeysSet, processKeysSet);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = applyHighlighting(update.view, envKeysSet, processKeysSet);
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
