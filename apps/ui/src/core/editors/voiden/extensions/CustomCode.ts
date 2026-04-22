import Code from "@tiptap/extension-code";
import { markInputRule, markPasteRule } from "@tiptap/core";

export const CustomCode = Code.extend({
  exitable: true,

  addKeyboardShortcuts() {
    return {
      "`": () => {
        const { state } = this.editor;
        const { $from } = state.selection;

        const isInCode =
          state.storedMarks?.some((mark) => mark.type.name === "code") ||
          $from.marks().some((mark) => mark.type.name === "code");

        if (isInCode) {
          this.editor.commands.unsetMark("code");
          return true;
        }

        return false;
      },

      // Exit code mark on Enter so the new paragraph doesn't inherit it
      Enter: () => {
        const { state } = this.editor;
        const { $from } = state.selection;

        const isInCode =
          state.storedMarks?.some((mark) => mark.type.name === "code") ||
          $from.marks().some((mark) => mark.type.name === "code");

        if (isInCode) {
          this.editor.commands.unsetMark("code");
        }
        return false;
      },
    };
  },

  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|\s)(`([^`]+)`)$/,
        type: this.type,
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: /`([^`]+)`/g,
        type: this.type,
      }),
    ];
  },
});
