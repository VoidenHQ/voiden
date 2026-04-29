import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const pluginKey = new PluginKey<{ ghost: string; insertAt: number } | null>('inlineVarSuggestion')

let envKeys: string[] = []
let processKeys: string[] = []

export function updateInlineEnvKeys(keys: string[]) { envKeys = keys }
export function updateInlineProcessKeys(keys: string[]) { processKeys = keys }

/**
 * Given text before the cursor, returns the best matching ghost text
 * and the position in the document where the completed text should be inserted.
 */
function computeGhost(textBefore: string, cursorPos: number): { ghost: string; insertAt: number } | null {
  // {{process.PARTIAL  →  runtime vars
  const processMatch = textBefore.match(/\{\{process\.([\w-]*)$/)
  if (processMatch) {
    const partial = processMatch[1]
    const match = processKeys.find(
      k => k.toLowerCase().startsWith(partial.toLowerCase()) && k.toLowerCase() !== partial.toLowerCase()
    )
    if (match) {
      const remaining = match.slice(partial.length)
      const ghost = remaining + (textBefore.endsWith('}}') ? '' : '}}')
      return { ghost, insertAt: cursorPos }
    }
    return null
  }

  // {{PARTIAL  →  env vars (skip if starts with $ — that's $req/$res)
  const envMatch = textBefore.match(/\{\{([\w-]+)$/)
  if (envMatch && !envMatch[1].startsWith('process')) {
    const partial = envMatch[1]
    const match = envKeys.find(
      k => k.toLowerCase().startsWith(partial.toLowerCase()) && k.toLowerCase() !== partial.toLowerCase()
    )
    if (match) {
      const remaining = match.slice(partial.length)
      const ghost = remaining + (textBefore.endsWith('}}') ? '' : '}}')
      return { ghost, insertAt: cursorPos }
    }
    return null
  }

  return null
}

function makeGhostWidget(text: string) {
  const el = document.createElement('span')
  el.textContent = text
  el.setAttribute('data-inline-ghost', 'true')
  el.style.cssText = [
    'color: var(--color-comment, #888)',
    'opacity: 0.5',
    'pointer-events: none',
    'user-select: none',
    'font-style: italic',
  ].join(';')
  return el
}

const inlineVarPlugin = new Plugin({
  key: pluginKey,

  state: {
    init: () => null,
    apply(tr, _prev) {
      const sel = tr.selection
      if (!sel.empty) return null

      const cursorPos = sel.from
      const textBefore = tr.doc.textBetween(
        Math.max(0, cursorPos - 80),
        cursorPos,
        '\n',
        '\0'
      )

      return computeGhost(textBefore, cursorPos)
    },
  },

  props: {
    decorations(state) {
      const suggestion = pluginKey.getState(state)
      if (!suggestion) return DecorationSet.empty

      const widget = Decoration.widget(
        suggestion.insertAt,
        () => makeGhostWidget(suggestion.ghost),
        { side: 1, key: 'inline-ghost' }
      )
      return DecorationSet.create(state.doc, [widget])
    },
  },
})

export const InlineVarSuggestion = Extension.create({
  name: 'inlineVarSuggestion',

  addProseMirrorPlugins() {
    return [inlineVarPlugin]
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const suggestion = pluginKey.getState(editor.state)
        if (!suggestion) return false

        // Check if there is already a closing `}}` right after the cursor
        const { from } = editor.state.selection
        const textAfter = editor.state.doc.textBetween(from, Math.min(from + 2, editor.state.doc.content.size))
        const alreadyClosed = textAfter === '}}'

        const insertText = alreadyClosed
          ? suggestion.ghost.replace(/\}\}$/, '')
          : suggestion.ghost

        editor.chain().focus().insertContent(insertText).run()
        return true
      },
    }
  },
})
