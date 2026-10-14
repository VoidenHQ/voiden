import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import tippy, { Instance, Props } from 'tippy.js'
import VariableList from './VariableList';

export const ResSuggestionPluginKey = new PluginKey('resSuggestion');

let activePopup: Instance<Props>[] | undefined;

export const isResSuggestionOpen = () => !!activePopup?.[0]?.state?.isVisible;

interface SuggestionItem {
  label: string
  description?: string
}

interface SuggestionProps {
  editor: any
  range: { from: number; to: number }
  props: SuggestionItem
}
export const ResSuggestion = Extension.create({
  name: 'resSuggestion',
  
  addOptions() {
    return {
      suggestion: {
        char: '{{$res.',
        pluginKey: ResSuggestionPluginKey,
        command: ({ editor, range, props }: SuggestionProps) => {
          // Determine which variable type based on the query
          const text = `{{$res.${props.label}`
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(text)
            .run()
        },
        allow: ({ state, range }: any) => {
          const $from = state.doc.resolve(range.from)
          const type = $from.parent.type.name
          return type === 'tableCell' || type === 'paragraph'
        },
        items: ({ query }: { query: string }) => {
          // Remove the trigger char from query for filtering
          const cleanQuery = query.startsWith('$') ? query.slice(1) : query
          
          const resSuggestions: SuggestionItem[] = [
            { label: 'status', description: 'Response status code' },
            { label: 'headers', description: 'Response headers' },
            { label: 'body', description: 'Response body' },
            { label: 'contentType', description: 'Content Type' },
          ]


          // Combine all suggestions
          const allSuggestions: SuggestionItem[] = [
            ...resSuggestions,
          ]

          // Filter based on query
          if (!cleanQuery) {
            return allSuggestions
          }

          return allSuggestions.filter(item => 
            item.label.toLowerCase().includes(cleanQuery.toLowerCase())
          )
        },

        render: () => {
          let component: ReactRenderer
          let popup: Instance<Props>[]

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(VariableList, {
                props,
                editor: props.editor,
              })

              if (!props.clientRect) {
                return
              }

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              })
              activePopup = popup
            },

            onUpdate(props: any) {
              component.updateProps(props)

              if (!props.clientRect) {
                return
              }

              popup[0].setProps({
                getReferenceClientRect: props.clientRect,
              })
            },

            onKeyDown(props: any) {
              if (props.event.key === 'Escape') {
                popup[0].hide()
                return true
              }
              // @ts-expect-error - component.ref is accessible
              return component.ref?.onKeyDown(props)
            },

            onExit() {
              popup[0].destroy()
              component.destroy()
              if (activePopup === popup) {
                activePopup = undefined
              }
            },
          }
        },
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})