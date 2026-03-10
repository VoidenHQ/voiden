/**
 * Voiden Scripting Plugin
 *
 * Registers pre_script and post_script block nodes, pipeline hooks,
 * slash commands, and exposes helpers for other plugins.
 */

import React from 'react';
import {
  preProcessingScriptHook,
  preSendScriptHook,
  postProcessScriptHook,
} from './lib/pipelineHooks';

export default function createVoidenScriptingPlugin(context: any) {
  const extendedContext = {
    ...context,
    pipeline: {
      registerHook: async (stage: string, handler: any, priority?: number) => {
        try {
          // @ts-ignore - Vite dynamic import
          const { hookRegistry } = await import(/* @vite-ignore */ '@/core/request-engine/pipeline');
          hookRegistry.registerHook('voiden-scripting', stage as any, handler, priority);
        } catch (error) {
          console.error('[voiden-scripting] Failed to register hook:', error);
        }
      },
    },
  };

  return {
    onload: async () => {
      // 1. Import and create script block nodes
      const { NodeViewWrapper, CodeEditor, RequestBlockHeader } = context.ui.components;
      const { createScriptNode } = await import('./nodes/ScriptNode');
      const ScriptHelp = await import('./nodes/ScriptHelp');

      const PreScriptNode = createScriptNode(
        {
          name: 'pre_script',
          tag: 'pre-script',
          title: 'PRE-REQUEST SCRIPT',
          defaultBody: "",
        },
        NodeViewWrapper,
        CodeEditor,
        RequestBlockHeader,
        context.project.openFile,
        React.createElement(ScriptHelp.PreScriptHelp),
      );

      const PostScriptNode = createScriptNode(
        {
          name: 'post_script',
          tag: 'post-script',
          title: 'POST-RESPONSE SCRIPT',
          defaultBody: "",
        },
        NodeViewWrapper,
        CodeEditor,
        RequestBlockHeader,
        context.project.openFile,
        React.createElement(ScriptHelp.PostScriptHelp),
      );

      // 2. Register TipTap extensions
      context.registerVoidenExtension(PreScriptNode);
      context.registerVoidenExtension(PostScriptNode);

      // 2a. Register script assertion results node for response panel
      const { createScriptAssertionResultsNode } = await import('./nodes/ScriptAssertionResultsNode');
      const { useParentResponseDoc } = context.ui.hooks;
      const ScriptAssertionResultsNode = createScriptAssertionResultsNode(NodeViewWrapper, useParentResponseDoc);
      context.registerVoidenExtension(ScriptAssertionResultsNode);

      // 2b. Register CodeMirror autocompletion for voiden.* API
      const { vdAutocomplete } = await import('./lib/vdAutocomplete');
      context.registerCodemirrorExtension(vdAutocomplete());

      // 3. Register linkable node types and display names
      context.registerLinkableNodeTypes(['pre_script', 'post_script']);
      context.registerNodeDisplayNames({
        'pre_script': 'Pre-Request Script',
        'post_script': 'Post-Response Script',
      });

      // 4. Register block owners for paste handling
      context.paste.registerBlockOwner({
        blockType: 'pre_script',
        allowExtensions: false,
        handlePasteInside: () => false,
        processBlock: (block: any) => block,
      });
      context.paste.registerBlockOwner({
        blockType: 'post_script',
        allowExtensions: false,
        handlePasteInside: () => false,
        processBlock: (block: any) => block,
      });

      // 5. Register slash commands
      context.addVoidenSlashGroup({
        name: 'scripting',
        title: 'Scripts',
        commands: [
          {
            name: 'pre-script',
            label: 'Pre-Request Script',
            slash: '/pre-script',
            singleton: true,
            compareKeys: ['pre_script'],
            aliases: ['pre-request', 'prescript'],
            description: 'Insert a pre-request JavaScript script block',
            action: (editor: any) => {
              const range = {
                from: editor.state.selection.$from.pos,
                to: editor.state.selection.$to.pos,
              };
              editor.storage.pre_script.shouldFocusNext = true;
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent([{ type: 'pre_script' }])
                .run();
            },
          },
          {
            name: 'post-script',
            label: 'Post-Response Script',
            slash: '/post-script',
            singleton:true,
            compareKeys: ['post_script'],
            aliases: ['post-response', 'postscript'],
            description: 'Insert a post-response JavaScript script block',
            action: (editor: any) => {
              const range = {
                from: editor.state.selection.$from.pos,
                to: editor.state.selection.$to.pos,
              };
              editor.storage.post_script.shouldFocusNext = true;
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent([{ type: 'post_script' }])
                .run();
            },
          },
        ],
      });

      // 6. Register pipeline hooks
      if (extendedContext.pipeline?.registerHook) {
        // Pre-processing: capture editor document (priority 5, runs early)
        await extendedContext.pipeline.registerHook(
          'pre-processing',
          preProcessingScriptHook,
          5,
        );

        // Pre-send: execute pre-request script (priority 15, after faker at 10)
        await extendedContext.pipeline.registerHook(
          'pre-send',
          preSendScriptHook,
          15,
        );

        // Post-processing: execute post-response script (priority 25, after assertions at 15)
        await extendedContext.pipeline.registerHook(
          'post-processing',
          postProcessScriptHook,
          25,
        );
      }

      // 7. Register sidebar tab for script console logs
      const { ScriptLogsSidebar } = await import('./components/ScriptLogsSidebar');
      context.registerSidebarTab('right', {
        id: 'script-logs',
        title: 'Script Logs',
        icon: 'Logs',
        component: ScriptLogsSidebar,
      });

      // 8. Expose helpers for other plugins
      const { scriptingHelpers } = await import('./lib/helpers');
      context.exposeHelpers(scriptingHelpers);
    },

    onunload: async () => {
      try {
        // @ts-ignore - Vite dynamic import
        const { hookRegistry } = await import(/* @vite-ignore */ '@/core/request-engine/pipeline');
        hookRegistry.unregisterExtension('voiden-scripting');
      } catch {
        // Graceful cleanup
      }
    },
  };
}
