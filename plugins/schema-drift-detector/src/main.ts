/**
 * Schema Drift Detector Plugin
 *
 * Detects structural changes, regressions, and schema evolutions in API response payloads (JSON & XML).
 */

import type { PluginContext } from '@voiden/sdk/ui';
import React from 'react';
import { SchemaDriftSection } from './components/SchemaDriftSection';
import { driftStore } from './store/driftStore';
import { inferPayloadSchema } from './utils/schemaInferrer';
import { generateDriftReport } from './utils/driftComparator';

const schemaDriftDetectorPlugin = (context: PluginContext) => {
  const showToast = (context as any)?.ui?.showToast as
    | ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void)
    | undefined;

  return {
    onload: async () => {
      // 1. Register Response Panel Section
      if (typeof (context as any).registerResponsePanelSection === 'function') {
        (context as any).registerResponsePanelSection({
          id: 'schema-drift',
          label: 'Schema Drift',
          component: ({ tabId, embedded }: { tabId?: string; embedded?: boolean }) =>
            React.createElement(SchemaDriftSection, { tabId, embedded, showToast }),
          hasResults: (tabId?: string) => {
            if (!tabId) return false;
            return !!driftStore.getReport(tabId);
          },
          subscribe: driftStore.subscribe,
        });
      }

      // 2. Register Response Hook via onProcessResponse or pipeline
      if (typeof (context as any).onProcessResponse === 'function') {
        (context as any).onProcessResponse(async (response: any, docContent?: any) => {
          try {
            if (!response || response.status === undefined) return;

            const tabId =
              (await (context as any).response?.getCurrentTabId?.()) ||
              response?.tabId ||
              '__default__';

            const url = response.url || docContent?.attrs?.url;
            const method = response.requestMeta?.method || 'GET';
            const contentType = response.contentType || null;
            const body = response.body;

            if (body === undefined || body === null) return;

            // Infer current payload schema
            const { schema: currentSchema, format } = inferPayloadSchema(body, contentType);

            const state = driftStore.getState();
            const baselineEntry = state.baselines[tabId];

            if (!baselineEntry) {
              if (state.settings.autoRecordBaseline) {
                // Auto-record initial baseline
                driftStore.setBaseline(tabId, currentSchema, {
                  url,
                  method,
                  format,
                });

                const initialReport = generateDriftReport({
                  tabId,
                  requestUrl: url,
                  requestMethod: method,
                  statusCode: response.status,
                  baselineSchema: undefined,
                  currentSchema,
                  format,
                });

                driftStore.setReport(tabId, initialReport);
              }
            } else {
              // Compare current against recorded baseline
              const report = generateDriftReport({
                tabId,
                requestUrl: url,
                requestMethod: method,
                statusCode: response.status,
                baselineSchema: baselineEntry.schema,
                currentSchema,
                format,
                options: {
                  ignoreRules: state.ignoreRules,
                  strictArrays: state.settings.strictArrays,
                  checkNullability: state.settings.checkNullability,
                  ignoreAddedFields: state.settings.ignoreAddedFields,
                },
              });

              driftStore.setReport(tabId, report);

              if (report.hasBreakingChanges) {
                showToast?.(
                  `⚠️ Schema Drift: ${report.summary.breaking} breaking change(s) detected!`,
                  'warning'
                );
              }
            }
          } catch (err) {
            console.error('[SchemaDriftDetector] Error processing response:', err);
          }
        });
      }

      // 3. Register Status Bar item for quick info
      if (typeof (context as any).registerStatusBarItem === 'function') {
        (context as any).registerStatusBarItem({
          id: 'schema-drift-status-item',
          text: 'Schema Drift',
          icon: 'GitCompare',
          tooltip: 'API Schema Drift Detector',
          onClick: async () => {
            const currentTabId = await (context as any).response?.getCurrentTabId?.();
            const report = driftStore.getReport(currentTabId);
            if (report) {
              if (report.hasBreakingChanges) {
                showToast?.(
                  `Schema Drift: ${report.summary.breaking} breaking changes in active tab`,
                  'warning'
                );
              } else {
                showToast?.('Schema Drift: Active response matches baseline', 'success');
              }
            } else {
              showToast?.('Schema Drift: No active response schema analyzed yet', 'info');
            }
          },
        });
      }
    },

    onunload: async () => {
      // Clean up when plugin is unloaded / disabled
    },
  };
};

export default schemaDriftDetectorPlugin;
