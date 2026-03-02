import type { PluginContext } from '@voiden/sdk/ui';
import { createCollectionRunnerNode } from './nodes/CollectionRunnerNode';

/** Initial table content inserted by the slash command */
function makeInitialContent() {
  return [
    {
      type: 'collection-runner',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null },
                  content: [{ type: 'paragraph' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

export default function createCollectionRunnerPlugin(context: PluginContext) {
  // Guard against re-entrancy: when we're running linked files their responses
  // must NOT re-trigger the collection again.
  let isCollectionRunning = false;

  return {
    onload: async () => {
      const { RequestBlockHeader } = context.ui.components;

      // ── 1. Register the Tiptap node ──────────────────────────────────────────
      const CollectionRunnerNode = createCollectionRunnerNode(RequestBlockHeader);
      context.registerVoidenExtension(CollectionRunnerNode);

      // ── 2. Register slash command ────────────────────────────────────────────
      context.addVoidenSlashGroup({
        name: 'collection',
        title: 'Collection',
        commands: [
          {
            name: 'collection-runner',
            label: 'Collection Runner',
            slash: '/collection-runner',
            singleton: true,
            compareKeys: ['collection-runner'],
            aliases: ['runner', 'collection', 'run'],
            description:
              'Run linked .void files after this file\'s request completes. Type @ in each row to link a file.',
            action: (editor: any) => {
              const { from, to } = editor.state.selection;
              editor
                .chain()
                .focus()
                .deleteRange({ from, to })
                .insertContent(makeInitialContent())
                .run();
            },
          },
        ],
      });

      // ── 3. Register right sidebar tab ────────────────────────────────────────
      const { CollectionRunnerSidebar } = await import('./components/CollectionRunnerSidebar');
      context.registerSidebarTab('right', {
        id: 'collection-runner',
        title: 'Collection Runner',
        icon: 'Play',
        component: CollectionRunnerSidebar,
      });
      // ── 4. Hook into the response pipeline ───────────────────────────────────
      // After the current file's own request completes, check whether it contains
      // a collection-runner block. If so, execute the linked files in order.
      context.onProcessResponse(async (_response) => {
        // Do nothing while a collection is already in flight (prevents recursion
        // when linked-file requests also fire onProcessResponse).
        if (isCollectionRunning) return;

        try {
          const editor = context.project.getActiveEditor('voiden');
          if (!editor) return;

          const docJson = editor.getJSON();

          // Find the first collection-runner node in the document
          const runnerNode = (docJson.content ?? []).find(
            (n: any) => n.type === 'collection-runner'
          );
          if (!runnerNode) return;

          const { extractFilesFromNodeJson, runCollection } = await import(
            './lib/collectionRunnerEngine'
          );

          const files = extractFilesFromNodeJson(runnerNode);
          if (!files.length) return;

          isCollectionRunning = true;
          try {
            await runCollection(files, context);
            // Open the sidebar so the user can see per-file results
            await context.ui.openRightSidebarTab('collection-runner');
          } finally {
            isCollectionRunning = false;
          }
        } catch (err) {
          isCollectionRunning = false;
          console.error('[CollectionRunner] onProcessResponse error:', err);
        }
      });
    },

    onunload: async () => {
      isCollectionRunning = false;
      try {
        const { useCollectionRunnerStore } = await import('./lib/collectionRunnerStore');
        useCollectionRunnerStore.getState().reset();
      } catch {
        // Graceful cleanup
      }
    },
  };
}
