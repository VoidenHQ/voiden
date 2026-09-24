/**
 * HTTP Archive (HAR) Importer Extension
 *
 * Enables importing HTTP Archive (.har) files and converting captured browser requests to Voiden .void request files.
 */

import type { PluginContext } from '@voiden/sdk/ui';
import React from 'react';
import { HarImportButton } from './components/HarImportButton';

const harImportPlugin = (context: PluginContext) => {
  const showToast = (context as any)?.ui?.showToast as
    | ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void)
    | undefined;

  return {
    onload: () => {
      context.registerEditorAction({
        id: 'har-import-button',
        component: (props: any) =>
          React.createElement(HarImportButton, {
            ...props,
            showToast,
          }),
        predicate: (tab) => {
          if (!tab || !tab.title) return false;
          const title = tab.title.toLowerCase();

          // Direct match for .har extension
          if (title.endsWith('.har')) return true;

          // Match .json files containing HAR structure ("log" and "entries")
          if (title.endsWith('.json') && tab.content) {
            return (
              tab.content.indexOf('"log"') > -1 &&
              tab.content.indexOf('"entries"') > -1
            );
          }

          return false;
        },
      });
    },
    onunload: () => {},
  };
};

export default harImportPlugin;
