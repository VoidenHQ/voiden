import type {
  BaselineEntry,
  DriftDetectorSettings,
  DriftReport,
  DriftStoreState,
  IgnoreRule,
  SchemaNode,
} from '../types';

const STORAGE_KEY_BASELINES = '__voiden_drift_baselines__';
const STORAGE_KEY_RULES = '__voiden_drift_ignore_rules__';
const STORAGE_KEY_SETTINGS = '__voiden_drift_settings__';

const DEFAULT_IGNORE_RULES: IgnoreRule[] = [
  { id: 'rule-timestamp', pattern: '*.timestamp', type: 'wildcard', enabled: true, description: 'Ignore timestamp properties' },
  { id: 'rule-created-at', pattern: '*.createdAt', type: 'wildcard', enabled: true, description: 'Ignore creation timestamps' },
  { id: 'rule-updated-at', pattern: '*.updatedAt', type: 'wildcard', enabled: true, description: 'Ignore update timestamps' },
  { id: 'rule-id-dynamic', pattern: '*._id', type: 'wildcard', enabled: false, description: 'Ignore MongoDB _id changes' },
  { id: 'rule-request-id', pattern: '*.requestId', type: 'wildcard', enabled: true, description: 'Ignore dynamic request IDs' },
];

const DEFAULT_SETTINGS: DriftDetectorSettings = {
  autoRecordBaseline: true,
  strictArrays: false,
  checkNullability: true,
  ignoreAddedFields: false,
};

function loadStoredBaselines(): Record<string, BaselineEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BASELINES);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadStoredRules(): IgnoreRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RULES);
    return raw ? JSON.parse(raw) : DEFAULT_IGNORE_RULES;
  } catch {
    return DEFAULT_IGNORE_RULES;
  }
}

function loadStoredSettings(): DriftDetectorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

class DriftStoreManager {
  private state: DriftStoreState = {
    reports: {},
    baselines: loadStoredBaselines(),
    ignoreRules: loadStoredRules(),
    settings: loadStoredSettings(),
  };

  private listeners: Set<() => void> = new Set();

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore subscriber errors
      }
    });
  }

  public getState(): DriftStoreState {
    return this.state;
  }

  public setReport(key: string, report: DriftReport) {
    this.state.reports = {
      ...this.state.reports,
      [key]: report,
    };
    this.notify();
  }

  public getReport(key?: string): DriftReport | undefined {
    if (!key) return undefined;
    return this.state.reports[key];
  }

  public setBaseline(
    key: string,
    schema: SchemaNode,
    meta?: { url?: string; method?: string; format?: 'json' | 'xml' | 'unknown'; locked?: boolean }
  ) {
    const entry: BaselineEntry = {
      key,
      schema,
      updatedAt: Date.now(),
      locked: meta?.locked ?? false,
      url: meta?.url,
      method: meta?.method,
      format: meta?.format ?? 'json',
    };

    this.state.baselines = {
      ...this.state.baselines,
      [key]: entry,
    };

    try {
      localStorage.setItem(STORAGE_KEY_BASELINES, JSON.stringify(this.state.baselines));
    } catch {
      // ignore
    }

    this.notify();
  }

  public getBaseline(key?: string): BaselineEntry | undefined {
    if (!key) return undefined;
    return this.state.baselines[key];
  }

  public resetBaseline(key: string) {
    const next = { ...this.state.baselines };
    delete next[key];
    this.state.baselines = next;

    try {
      localStorage.setItem(STORAGE_KEY_BASELINES, JSON.stringify(this.state.baselines));
    } catch {
      // ignore
    }

    this.notify();
  }

  public addIgnoreRule(rule: Omit<IgnoreRule, 'id'>) {
    const newRule: IgnoreRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...rule,
    };

    this.state.ignoreRules = [...this.state.ignoreRules, newRule];
    try {
      localStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(this.state.ignoreRules));
    } catch {
      // ignore
    }

    this.notify();
  }

  public removeIgnoreRule(id: string) {
    this.state.ignoreRules = this.state.ignoreRules.filter((r) => r.id !== id);
    try {
      localStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(this.state.ignoreRules));
    } catch {
      // ignore
    }

    this.notify();
  }

  public toggleIgnoreRule(id: string) {
    this.state.ignoreRules = this.state.ignoreRules.map((r) =>
      r.id === id ? { ...r, enabled: !r.enabled } : r
    );

    try {
      localStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(this.state.ignoreRules));
    } catch {
      // ignore
    }

    this.notify();
  }

  public updateSettings(partial: Partial<DriftDetectorSettings>) {
    this.state.settings = {
      ...this.state.settings,
      ...partial,
    };

    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(this.state.settings));
    } catch {
      // ignore
    }

    this.notify();
  }
}

export const driftStore = new DriftStoreManager();
