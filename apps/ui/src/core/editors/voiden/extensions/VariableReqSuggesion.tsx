import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import tippy, { Instance, Props } from 'tippy.js'
import VariableList from './VariableList';
import { PluginKey } from '@tiptap/pm/state';

export const ReqSuggestionPluginKey = new PluginKey('reqSuggestion');


interface SuggestionItem {
  label: string
  value:string
  description?: string
}

interface SuggestionProps {
  editor: any
  range: { from: number; to: number }
  props: SuggestionItem
}

export const ReqSuggestion = Extension.create({
  name: 'reqSuggestion',

  addOptions() {
    return {
      suggestion: {
        char: '{{$req.',
            pluginKey: ReqSuggestionPluginKey,
        command: ({ editor, range, props }: SuggestionProps) => {
          // Determine which variable type based on the query
          const text = `{{$req.${props.label}`
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
          
          // Define suggestions for different variable types
          const reqSuggestions: SuggestionItem[] = [
            { label: 'headers', value:'headers',description: 'Request headers' },
            { label: 'body', value:'body',description: 'Request body' },
            { label: 'bodyParams', value:'bodyParams',description: 'Request parameters' },
            { label: 'contentType',value:'contentType', description: 'Path parameters' },
            { label: 'metadata', value:'metadata',description: 'Authentication data' },
            { label: 'queryParams', value:'queryParams',description: 'Query parameters' },
            { label: 'method', value:'method',description: 'HTTP method' },
            { label: 'url', value:'url',description: 'Request URL' },
            { label: 'pathParams', value:'pathParams',description: 'Path parameters' },
          ]


          // Combine all suggestions
          const allSuggestions: SuggestionItem[] = [
            ...reqSuggestions,
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
