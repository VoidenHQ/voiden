/**
 * Simple Assertions Plugin
 * Provides assertion testing capabilities for HTTP requests
 */

import type { PluginContext } from "@voiden/sdk/ui";
import { insertAssertionsTable } from "./lib/utils";
import { postProcessAssertionsHook } from "./lib/pipelineHook";
import { enhanceResponseWithAssertions } from "./lib/responseEnhancer";

export default function createSimpleAssertionsPlugin(context: PluginContext) {
  // Extend context with pipeline API
  const extendedContext = {
    ...context,
    pipeline: {
      registerHook: async (stage: string, handler: any, priority?: number) => {
        try {
          // @ts-ignore - Vite dynamic import
          const { hookRegistry } = await import(/* @vite-ignore */ '@/core/request-engine/pipeline');
          hookRegistry.registerHook('simple-assertions', stage as any, handler, priority);
        } catch (error) {
          console.error("Failed to register hook:", error);
        }
      },
    },
  };

  return {
    onload: async () => {

      // Inject global CSS for placeholder text in empty cells
      const styleId = 'simple-assertions-styles';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          /* Placeholder for first cell in first row (Description) */
          .assertions-table-container table tbody tr:first-child td:nth-child(1) p:empty::before,
          .assertions-table-container table tr:first-child td:nth-child(1) p:empty::before {
            content: "Description";
            opacity: 0.4;
            color: var(--text, currentColor);
          }

          /* Placeholder for second cell in first row (Field) */
          .assertions-table-container table tbody tr:first-child td:nth-child(2) p:empty::before,
          .assertions-table-container table tr:first-child td:nth-child(2) p:empty::before {
            content: "Field";
            opacity: 0.4;
            color: var(--text, currentColor);
          }

          /* Placeholder for third cell in first row (Operator) */
          .assertions-table-container table tbody tr:first-child td:nth-child(3) p:empty::before,
          .assertions-table-container table tr:first-child td:nth-child(3) p:empty::before {
            content: "Operator";
            opacity: 0.4;
            color: var(--text, currentColor);
          }

          /* Placeholder for fourth cell in first row (Expected Value) */
          .assertions-table-container table tbody tr:first-child td:nth-child(4) p:empty::before,
          .assertions-table-container table tr:first-child td:nth-child(4) p:empty::before {
            content: "Expected Value";
            opacity: 0.4;
            color: var(--text, currentColor);
          }
        `;
        document.head.appendChild(style);
      }

      // Dynamically import React components
      const { NodeViewWrapper } = await import("@tiptap/react");

      // Import and register AssertionsTable node
      const { createAssertionsTableNodeView } = await import(
        "./nodes/AssertionsTable"
      );
      const { RequestBlockHeader } = context.ui.components;
      const AssertionsTableNode = createAssertionsTableNodeView(
        RequestBlockHeader,
        context.project.openFile
      );
      context.registerVoidenExtension(AssertionsTableNode);

      // Import and register AssertionResults node (for response display)
      const { createAssertionResultsNode } = await import(
        "./nodes/AssertionResultsNode"
      );
      const { useParentResponseDoc } = context.ui.hooks;
      const AssertionResultsNode = createAssertionResultsNode(NodeViewWrapper, useParentResponseDoc);
      context.registerVoidenExtension(AssertionResultsNode);

      // Register linkable node types
      context.registerLinkableNodeTypes(["assertions-table", "assertion-results"]);

      // Register display names for node types
      context.registerNodeDisplayNames({
        'assertions-table': 'Assertions Table',
        'assertion-results': 'Assertion Results',
      });

      // Register block owner
      context.paste.registerBlockOwner({
        blockType: 'assertions-table',
        allowExtensions: true,
        handlePasteInside: (text: any, html: any, node: any, view: any) => {
          // Return false to let prosemirror-tables handle paste
          // This enables tab-separated value parsing into table columns
          return false;
        },
        processBlock: (block: any) => {
          return block;
        },
      });

      // Register table cell autocomplete suggestions for assertions
      context.registerTableSuggestions('assertions-table', {
        // Col 0 = Description (no suggestions)
        1: [ // Col 1 = Field
          { label: 'status', description: 'HTTP status code' },
          { label: 'statusText', description: 'HTTP status text' },
          { label: 'body', description: 'Response body' },
          { label: 'header.', description: 'Response header (e.g. header.Content-Type)' },
          { label: 'responseTime', description: 'Response time in ms' },
          { label: 'body.', description: 'JSON path (e.g. body.data[0].id)' },
        ],
        2: [ // Col 2 = Operator
          { label: 'equals', description: 'Strict equality' },
          { label: 'not-equals', description: 'Not equal' },
          { label: 'contains', description: 'String contains' },
          { label: 'not-contains', description: 'String does not contain' },
          { label: 'starts-with', description: 'String starts with' },
          { label: 'ends-with', description: 'String ends with' },
          { label: 'matches', description: 'Regex match' },
          { label: 'exists', description: 'Value is defined' },
          { label: 'not-exists', description: 'Value is null/undefined' },
          { label: 'greater-than', description: 'Numeric >' },
          { label: 'less-than', description: 'Numeric <' },
          { label: 'greater-equal', description: 'Numeric >=' },
          { label: 'less-equal', description: 'Numeric <=' },
          { label: 'is-empty', description: 'Value is empty' },
          { label: 'not-empty', description: 'Value is not empty' },
          { label: 'is-truthy', description: 'Value is truthy' },
          { label: 'is-falsy', description: 'Value is falsy' },
          { label: 'type-is', description: 'Type check (typeof)' },
        ],
        // Col 3 = Expected Value (no suggestions)
      });

      // Add slash command for inserting assertion table
      context.addVoidenSlashGroup({
        name: "simple-assertions",
        title: "Testing & Assertions",
        commands: [
          {
            name: "assertions",
            label: "Assertions Table",
            slash: "/assertions",
            description: "Insert assertion table for response testing",
            action: (editor) => {
              insertAssertionsTable(editor);
            },
          },
        ],
      });

      // Register pre-processing hook to capture editor document
      if (extendedContext.pipeline?.registerHook) {
        await extendedContext.pipeline.registerHook(
          "pre-processing",
          async (context: any) => {
            // Store editor JSON with expanded linked blocks in requestState for post-processing
            if (context.editor) {
              let editorJson = context.editor.getJSON();

              // Expand linked blocks so imported assertions are included
              try {
                // @ts-ignore - Path resolved at runtime in app context
                const { expandLinkedBlocksInDoc } = await import(/* @vite-ignore */ '@/core/editors/voiden/utils/expandLinkedBlocks');
                editorJson = await expandLinkedBlocksInDoc(editorJson, { forceRefresh: true });
              } catch (error) {
                console.warn("[Simple Assertions] Failed to expand linked blocks:", error);
                // Continue with unexpanded JSON
              }

              if (!context.requestState) {
                console.error("[Simple Assertions] No requestState in context!");
                return;
              }

              if (!context.requestState.metadata) {
                context.requestState.metadata = {};
              }
              context.requestState.metadata.editorDocument = editorJson;
            }
          },
          5 // Run early
        );

        await extendedContext.pipeline.registerHook(
          "post-processing",
          postProcessAssertionsHook,
          15 // Priority: run after response is processed but before display
        );
      }

      // Hook into response processing to inject assertion results
      const originalOnProcessResponse = context.onProcessResponse;
      if (originalOnProcessResponse) {
        context.onProcessResponse = async (response: any) => {
          // First, let the original handler run
          await originalOnProcessResponse(response);

          // Then check if we have assertion results to inject
          if (response.metadata?.assertionResults) {
            // Note: The assertion results will be added by modifying the
            // response document in the convertResponseToVoidenDoc function
            // We'll expose a helper for this
          }
        };
      }

      // Expose helper functions for other plugins to use
      context.exposeHelpers({
        enhanceResponseWithAssertions,
        insertAssertionsTable,
      });
    },

    onunload: async () => {
    },
  };
}
