export type SchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array'
  | 'unknown';

export interface SchemaNode {
  type: SchemaType | SchemaType[];
  format?: string; // 'uuid' | 'date-time' | 'email' | 'url' | 'int32' | 'float'
  nullable?: boolean;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
  example?: any;
  elementCount?: number;
  isXmlAttribute?: boolean;
}

export type DriftChangeKind =
  | 'FIELD_REMOVED'
  | 'FIELD_ADDED'
  | 'TYPE_CHANGED'
  | 'NULLABILITY_CHANGED'
  | 'ARRAY_ITEM_CHANGED'
  | 'STRUCTURE_CHANGED';

export type DriftSeverity = 'breaking' | 'warning' | 'info';

export interface DriftDifference {
  path: string; // e.g. "data.users[].profile.avatarUrl"
  kind: DriftChangeKind;
  severity: DriftSeverity;
  baselineType?: string;
  currentType?: string;
  description: string;
  baselineExample?: any;
  currentExample?: any;
  ignored: boolean;
  ignoreReason?: string;
}

export type IgnoreRuleType = 'wildcard' | 'exact' | 'regex';

export interface IgnoreRule {
  id: string;
  pattern: string; // e.g. "*.timestamp", "data[].id", "/^meta\./"
  type: IgnoreRuleType;
  enabled: boolean;
  description?: string;
}

export interface DriftSummary {
  total: number;
  breaking: number;
  warnings: number;
  additions: number;
  ignored: number;
}

export interface DriftReport {
  id: string;
  tabId?: string;
  filePath?: string;
  requestUrl?: string;
  requestMethod?: string;
  statusCode?: number;
  timestamp: number;
  hasBreakingChanges: boolean;
  hasNonBreakingChanges: boolean;
  isNewBaseline: boolean;
  summary: DriftSummary;
  differences: DriftDifference[];
  baselineSchema?: SchemaNode;
  currentSchema: SchemaNode;
  format: 'json' | 'xml' | 'unknown';
}

export interface BaselineEntry {
  key: string;
  schema: SchemaNode;
  updatedAt: number;
  locked?: boolean;
  url?: string;
  method?: string;
  format?: 'json' | 'xml' | 'unknown';
}

export interface DriftDetectorSettings {
  autoRecordBaseline: boolean;
  strictArrays: boolean;
  checkNullability: boolean;
  ignoreAddedFields: boolean;
}

export interface DriftStoreState {
  reports: Record<string, DriftReport>;
  baselines: Record<string, BaselineEntry>;
  ignoreRules: IgnoreRule[];
  settings: DriftDetectorSettings;
}
