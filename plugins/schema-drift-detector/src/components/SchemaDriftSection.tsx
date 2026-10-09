import React, { useEffect, useState, useMemo } from 'react';
import { driftStore } from '../store/driftStore';
import type { DriftDifference, DriftReport } from '../types';
import { exportToMarkdown, exportToJson, exportToText } from '../utils/reportExporter';
import { IgnoreRulesModal } from './IgnoreRulesModal';

interface Props {
  tabId?: string;
  embedded?: boolean;
  showToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const SchemaDriftSection: React.FC<Props> = ({ tabId, embedded, showToast }) => {
  const [report, setReport] = useState<DriftReport | undefined>(() => driftStore.getReport(tabId));
  const [filter, setFilter] = useState<'all' | 'breaking' | 'additions' | 'ignored'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isIgnoreModalOpen, setIsIgnoreModalOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Subscribe to store updates
  useEffect(() => {
    const unsub = driftStore.subscribe(() => {
      setReport(driftStore.getReport(tabId));
    });
    return unsub;
  }, [tabId]);

  const filteredDiffs = useMemo(() => {
    if (!report || !report.differences) return [];
    return report.differences.filter((diff) => {
      // Filter tab
      if (filter === 'breaking' && (diff.ignored || diff.severity !== 'breaking')) return false;
      if (filter === 'additions' && (diff.ignored || diff.kind !== 'FIELD_ADDED')) return false;
      if (filter === 'ignored' && !diff.ignored) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesPath = diff.path.toLowerCase().includes(q);
        const matchesDesc = diff.description.toLowerCase().includes(q);
        const matchesType =
          diff.baselineType?.toLowerCase().includes(q) ||
          diff.currentType?.toLowerCase().includes(q);
        return matchesPath || matchesDesc || matchesType;
      }
      return true;
    });
  }, [report, filter, searchQuery]);

  if (!report) {
    return (
      <div className="p-4 text-xs text-comment italic bg-bg border border-border rounded">
        No schema drift analysis available yet. Execute an API request to record or compare response schemas.
      </div>
    );
  }

  const handleUpdateBaseline = () => {
    if (!tabId || !report.currentSchema) return;
    driftStore.setBaseline(tabId, report.currentSchema, {
      url: report.requestUrl,
      method: report.requestMethod,
      format: report.format,
    });

    // Re-evaluate report with current schema as new baseline
    driftStore.setReport(tabId, {
      ...report,
      isNewBaseline: true,
      hasBreakingChanges: false,
      hasNonBreakingChanges: false,
      summary: {
        total: 0,
        breaking: 0,
        warnings: 0,
        additions: 0,
        ignored: 0,
      },
      differences: [],
      baselineSchema: report.currentSchema,
    });

    showToast?.('Updated baseline schema with current response', 'success');
  };

  const handleResetBaseline = () => {
    if (!tabId) return;
    driftStore.resetBaseline(tabId);
    showToast?.('Baseline schema reset for this endpoint', 'info');
  };

  const handleQuickIgnore = (diff: DriftDifference) => {
    driftStore.addIgnoreRule({
      pattern: diff.path,
      type: 'exact',
      enabled: true,
      description: `Quick ignored from response drift view`,
    });
    showToast?.(`Added ignore rule for "${diff.path}"`, 'success');
  };

  const handleCopyReport = async (format: 'md' | 'json' | 'txt') => {
    let content = '';
    if (format === 'md') content = exportToMarkdown(report);
    if (format === 'json') content = exportToJson(report);
    if (format === 'txt') content = exportToText(report);

    try {
      await navigator.clipboard.writeText(content);
      showToast?.(`Copied ${format.toUpperCase()} drift report to clipboard`, 'success');
    } catch {
      showToast?.('Failed to copy report', 'error');
    }
    setExportMenuOpen(false);
  };

  return (
    <div className="bg-bg text-text text-xs space-y-3 p-3 select-text">
      {/* Top Banner & Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-panel border border-border rounded-md">
        <div className="flex items-center gap-2">
          {report.isNewBaseline ? (
            <div className="flex items-center gap-1.5 text-accent font-medium">
              <span className="size-2 rounded-full bg-accent animate-pulse" />
              <span>Initial Baseline Recorded</span>
            </div>
          ) : report.hasBreakingChanges ? (
            <div className="flex items-center gap-1.5 text-status-error font-medium">
              <span className="size-2 rounded-full bg-status-error" />
              <span>{report.summary.breaking} Breaking Change(s) Detected</span>
            </div>
          ) : report.hasNonBreakingChanges ? (
            <div className="flex items-center gap-1.5 text-status-success font-medium">
              <span className="size-2 rounded-full bg-status-success" />
              <span>{report.summary.additions} Additive Extension(s)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-status-success font-medium">
              <span className="size-2 rounded-full bg-status-success" />
              <span>Schema Matches Baseline (0 Drift)</span>
            </div>
          )}
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-editor border border-border text-comment uppercase">
            {report.format}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleUpdateBaseline}
            className="px-2 py-1 bg-editor border border-border hover:bg-active text-text rounded transition-colors text-xs font-medium"
            title="Set current response schema as baseline"
          >
            📌 Set Baseline
          </button>
          <button
            onClick={() => setIsIgnoreModalOpen(true)}
            className="px-2 py-1 bg-editor border border-border hover:bg-active text-comment hover:text-text rounded transition-colors text-xs"
            title="Manage Ignore Rules"
          >
            ⚙️ Rules ({driftStore.getState().ignoreRules.filter((r) => r.enabled).length})
          </button>

          {/* Export dropdown */}
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              className="px-2 py-1 bg-editor border border-border hover:bg-active text-text rounded transition-colors text-xs font-medium"
            >
              📋 Export ▾
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 mt-1 w-36 bg-panel border border-border rounded shadow-lg z-20 py-1">
                <button
                  onClick={() => handleCopyReport('md')}
                  className="w-full text-left px-3 py-1.5 hover:bg-active text-xs text-text"
                >
                  Copy Markdown
                </button>
                <button
                  onClick={() => handleCopyReport('json')}
                  className="w-full text-left px-3 py-1.5 hover:bg-active text-xs text-text"
                >
                  Copy JSON
                </button>
                <button
                  onClick={() => handleCopyReport('txt')}
                  className="w-full text-left px-3 py-1.5 hover:bg-active text-xs text-text"
                >
                  Copy Summary Text
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Metric Counters & Filter Bar */}
      {!report.isNewBaseline && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 bg-editor p-1 border border-border rounded">
            <button
              onClick={() => setFilter('all')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-active text-text shadow-sm'
                  : 'text-comment hover:text-text'
              }`}
            >
              All ({report.summary.total})
            </button>
            <button
              onClick={() => setFilter('breaking')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                filter === 'breaking'
                  ? 'bg-status-error/20 text-status-error border border-status-error/40'
                  : 'text-comment hover:text-status-error'
              }`}
            >
              Breaking ({report.summary.breaking})
            </button>
            <button
              onClick={() => setFilter('additions')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                filter === 'additions'
                  ? 'bg-status-success/20 text-status-success border border-status-success/40'
                  : 'text-comment hover:text-status-success'
              }`}
            >
              Additions ({report.summary.additions})
            </button>
            <button
              onClick={() => setFilter('ignored')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                filter === 'ignored'
                  ? 'bg-active text-comment border border-border'
                  : 'text-comment hover:text-text'
              }`}
            >
              Ignored ({report.summary.ignored})
            </button>
          </div>

          <div className="flex-1 min-w-[140px] max-w-xs">
            <input
              type="text"
              placeholder="Search field path..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs px-2.5 py-1 bg-editor border border-border rounded text-text font-mono focus:outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      {/* Differences List */}
      {report.isNewBaseline ? (
        <div className="p-4 bg-editor border border-dashed border-border rounded text-center space-y-1">
          <div className="font-semibold text-text">Baseline Established</div>
          <div className="text-comment text-xs">
            Subsequent requests against this endpoint will be compared against this response structure.
          </div>
        </div>
      ) : filteredDiffs.length === 0 ? (
        <div className="p-4 bg-editor border border-border rounded text-center text-comment italic">
          {report.differences.length === 0
            ? 'No schema differences detected between this response and the baseline.'
            : 'No differences match the active filter or search query.'}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
          {filteredDiffs.map((diff, idx) => {
            const isBreaking = diff.severity === 'breaking' && !diff.ignored;
            const isAdded = diff.kind === 'FIELD_ADDED' && !diff.ignored;

            const badgeColor = diff.ignored
              ? 'bg-editor text-comment border-border'
              : isBreaking
              ? 'bg-status-error/15 text-status-error border-status-error/30'
              : isAdded
              ? 'bg-status-success/15 text-status-success border-status-success/30'
              : 'bg-status-warning/15 text-status-warning border-status-warning/30';

            return (
              <div
                key={idx}
                className="group flex items-start justify-between p-2 bg-editor border border-border rounded hover:bg-active transition-colors gap-2"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-mono uppercase font-bold px-1.5 py-0.5 rounded border ${badgeColor}`}
                    >
                      {diff.ignored ? 'IGNORED' : diff.kind.replace('_', ' ')}
                    </span>
                    <span className="font-mono text-xs font-semibold text-text truncate">
                      {diff.path}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-comment font-mono">
                    {diff.baselineType && (
                      <span>
                        baseline: <span className="text-text">{diff.baselineType}</span>
                      </span>
                    )}
                    {diff.baselineType && diff.currentType && <span>→</span>}
                    {diff.currentType && (
                      <span>
                        current: <span className="text-text">{diff.currentType}</span>
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-comment">{diff.description}</div>
                  {diff.ignored && diff.ignoreReason && (
                    <div className="text-[10px] text-accent italic">({diff.ignoreReason})</div>
                  )}
                </div>

                {/* Quick Ignore Action */}
                {!diff.ignored && (
                  <button
                    onClick={() => handleQuickIgnore(diff)}
                    className="opacity-0 group-hover:opacity-100 px-2 py-1 text-[11px] bg-bg border border-border text-comment hover:text-text rounded transition-all flex-shrink-0"
                    title="Add exact ignore rule for this field path"
                  >
                    + Ignore
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Ignore Rules Modal */}
      <IgnoreRulesModal
        isOpen={isIgnoreModalOpen}
        onClose={() => setIsIgnoreModalOpen(false)}
        showToast={showToast}
      />
    </div>
  );
};
