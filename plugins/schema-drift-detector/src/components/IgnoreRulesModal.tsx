import React, { useState } from 'react';
import { driftStore } from '../store/driftStore';
import type { IgnoreRule, IgnoreRuleType } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  showToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const IgnoreRulesModal: React.FC<Props> = ({ isOpen, onClose, showToast }) => {
  const [rules, setRules] = useState<IgnoreRule[]>(() => driftStore.getState().ignoreRules);
  const [pattern, setPattern] = useState('');
  const [type, setType] = useState<IgnoreRuleType>('wildcard');
  const [description, setDescription] = useState('');

  if (!isOpen) return null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) return;

    driftStore.addIgnoreRule({
      pattern: pattern.trim(),
      type,
      enabled: true,
      description: description.trim() || undefined,
    });

    setRules(driftStore.getState().ignoreRules);
    setPattern('');
    setDescription('');
    showToast?.(`Added ignore rule: ${pattern}`, 'success');
  };

  const handleToggle = (id: string) => {
    driftStore.toggleIgnoreRule(id);
    setRules(driftStore.getState().ignoreRules);
  };

  const handleRemove = (id: string) => {
    driftStore.removeIgnoreRule(id);
    setRules(driftStore.getState().ignoreRules);
    showToast?.('Removed ignore rule', 'info');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-panel border border-border rounded-lg shadow-xl w-full max-w-xl flex flex-col max-h-[85vh] overflow-hidden text-text">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Schema Drift Ignore Rules</span>
            <span className="text-xs text-comment font-mono">({rules.length} rules)</span>
          </div>
          <button
            onClick={onClose}
            className="text-comment hover:text-text p-1 rounded transition-colors text-xs"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Add Rule Form */}
          <form onSubmit={handleAdd} className="p-3 bg-editor border border-border rounded-md space-y-3">
            <div className="text-xs font-semibold text-text">Add New Ignore Rule</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <input
                  type="text"
                  placeholder="e.g. *.timestamp, data[].id, /_at$/"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 bg-bg border border-border rounded text-text font-mono focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as IgnoreRuleType)}
                  className="w-full text-xs px-2 py-1.5 bg-bg border border-border rounded text-text focus:outline-none focus:border-accent"
                >
                  <option value="wildcard">Wildcard (*)</option>
                  <option value="exact">Exact Match</option>
                  <option value="regex">Regular Expression</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Optional description / reason"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="flex-1 text-xs px-2.5 py-1.5 bg-bg border border-border rounded text-text focus:outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={!pattern.trim()}
                className="text-xs px-3 py-1.5 bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 font-medium rounded transition-colors disabled:opacity-50"
              >
                + Add Rule
              </button>
            </div>
          </form>

          {/* Rules List */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-comment">Configured Rules</div>
            {rules.length === 0 ? (
              <div className="text-xs text-comment italic p-4 text-center border border-dashed border-border rounded">
                No ignore rules configured. All schema changes will be reported.
              </div>
            ) : (
              rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between p-2.5 bg-bg border border-border rounded hover:bg-active transition-colors gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => handleToggle(rule.id)}
                      className="rounded border-border text-accent focus:ring-0 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-text truncate">
                          {rule.pattern}
                        </span>
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-editor border border-border text-comment">
                          {rule.type}
                        </span>
                      </div>
                      {rule.description && (
                        <div className="text-[11px] text-comment truncate">{rule.description}</div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(rule.id)}
                    className="text-xs text-comment hover:text-status-error p-1 rounded transition-colors"
                    title="Delete rule"
                  >
                    🗑️
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border bg-bg flex justify-end">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 bg-editor border border-border text-text hover:bg-active rounded transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
