/**
 * Voiden Stitch Plugin
 *
 * Batch-run multiple .void files with aggregated assertion results.
 * Registers the /stitch block node, results sidebar tab, and slash command.
 */

export default function createVoidenStitchPlugin(context: any) {
  return {
    onload: async () => {
      // 1. Import and create the StitchNode
      const { NodeViewWrapper, RequestBlockHeader } = context.ui.components;
      const { createStitchNode } = await import('./nodes/StitchNode');

      // Import useActiveEnvironment hook via dynamic Vite import
      // The StitchNodeView is a React component so it can call hooks
      // @ts-ignore - Vite dynamic import
      const { useActiveEnvironment, useEnvironments } = await import(/* @vite-ignore */ '@/core/environment/hooks') as any;

      // Open the stitch results sidebar tab
      const openResultsTab = () => {
        try {
          context.ui.openRightPanel();
          context.ui.openRightSidebarTab('stitch-results');
        } catch { /* best effort */ }
      };

      const StitchNode = createStitchNode(
        NodeViewWrapper,
        RequestBlockHeader,
        useActiveEnvironment,
        useEnvironments,
        openResultsTab,
      );

      // 2. Register TipTap extension
      context.registerVoidenExtension(StitchNode);

      // 3. Register display names
      context.registerNodeDisplayNames({
        'stitch': 'Stitch Runner',
      });

      // 4. Register block owner for paste handling
      context.paste.registerBlockOwner({
        blockType: 'stitch',
        allowExtensions: false,
        handlePasteInside: () => false,
        processBlock: (block: any) => block,
      });

      // 5. Register slash command
      context.addVoidenSlashGroup({
        name: 'stitch',
        title: 'Stitch Runner',
        commands: [
          {
            name: 'stitch',
            label: 'Stitch Runner',
            slash: '/stitch',
            singleton: false,
            aliases: ['batch', 'suite', 'collection-runner'],
            description: 'Insert a stitch block to batch-run multiple .void files',
            action: (editor: any) => {
              const range = {
                from: editor.state.selection.$from.pos,
                to: editor.state.selection.$to.pos,
              };
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent([{ type: 'stitch' }])
                .run();
            },
          },
        ],
      });

      // 6. Expose StitchResultsSidebar and stitchStore for the response panel to use
      const { StitchResultsSidebar } = await import('./components/StitchResultsSidebar');
      const { stitchStore } = await import('./lib/stitchStore');
      context.exposeHelpers({
        StitchResultsSidebar,
        stitchStore,
      });
    },

    onunload: async () => {
      // Cleanup: clear any in-progress state
      const { stitchStore } = await import('./lib/stitchStore');
      const run = stitchStore.getRun();
      if (run.status === 'running') {
        stitchStore.cancelRun();
      }
    },
  };
}
