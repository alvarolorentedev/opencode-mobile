// Provider-independent observability contracts. Features and shared services
// instrument through these types only; no backend SDK is imported above this
// boundary. See docs/architecture/observability.md.

export type ObservabilityLevel = 'debug' | 'info' | 'warn' | 'error';

export type ObservabilityKind = 'log' | 'span' | 'metric' | 'error';

export type ObservabilityStatus = 'ok' | 'error' | 'cancelled';

export type SafeAttribute = string | number | boolean;

export type SafeAttributes = Record<string, SafeAttribute | undefined>;

export type ObservabilityPreferences = {
  // Local diagnostic recording. On by default.
  diagnosticsEnabled: boolean;
  diagnosticsLevel: 'normal' | 'verbose';
  // Master remote switch. Individual categories remain separately
  // controllable in Settings. Defaults are enabled; a build without OTLP
  // credentials or the FOSS variant treats remote as unavailable.
  remoteTelemetryEnabled: boolean;
  remoteCrashReports: boolean;
  remotePerformance: boolean;
};

export type DiagnosticRecord = {
  v: 1;
  ts: number;
  kind: ObservabilityKind;
  name: string;
  level?: ObservabilityLevel;
  message?: string;
  stack?: string;
  attrs?: SafeAttributes;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  sessionId?: string;
  durationMs?: number;
  status?: ObservabilityStatus;
  value?: number;
  unit?: string;
};

export type Span = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startedAt: number;
  setAttribute: (key: string, value: SafeAttribute) => void;
  setAttributes: (attrs: SafeAttributes) => void;
  end: (status?: ObservabilityStatus, attrs?: SafeAttributes) => void;
  child: (name: string, attrs?: SafeAttributes) => Span;
};

export type StorageSnapshot = {
  bytes: number;
  files: number;
  oldestAt?: number;
  retentionDays: number;
  maxBytes: number;
  corruptFiles: number;
};

export type DiagnosticsRecent = {
  logs: DiagnosticRecord[];
  errors: DiagnosticRecord[];
  spans: DiagnosticRecord[];
};

export type ObservabilitySnapshot = {
  enabled: boolean;
  level: 'normal' | 'verbose';
  remoteAvailable: boolean;
  remoteTelemetryEnabled: boolean;
  remoteCrashReports: boolean;
  remotePerformance: boolean;
  storage: StorageSnapshot;
  metrics: DiagnosticRecord[];
  recent: DiagnosticsRecent;
  lastFailure?: DiagnosticRecord;
};

export type ObservabilityConfig = {
  preferences: ObservabilityPreferences;
  remoteAvailable: boolean;
  build: BuildMetadata;
};

export type BuildMetadata = {
  appVersion: string;
  buildNumber: string;
  platform: 'android' | 'ios' | 'web' | 'unknown';
  osVersion?: string;
  variant: 'production' | 'development' | 'foss';
  environment: string;
  sessionId: string;
};

export type ExportOptions = {
  includeDetails: boolean;
};

export type ExportResult = {
  uri: string;
  bytes: number;
  fileName: string;
  counts: Record<ObservabilityKind, number>;
};

export type Observability = {
  log: (level: ObservabilityLevel, name: string, attrs?: SafeAttributes) => void;
  logWithSpan: (span: Span, level: ObservabilityLevel, name: string, attrs?: SafeAttributes) => void;
  debug: (name: string, attrs?: SafeAttributes) => void;
  info: (name: string, attrs?: SafeAttributes) => void;
  warn: (name: string, attrs?: SafeAttributes) => void;
  error: (name: string, attrs?: SafeAttributes) => void;
  startSpan: (name: string, attrs?: SafeAttributes) => Span;
  span: <T>(name: string, attrs: SafeAttributes | undefined, run: (span: Span) => T | Promise<T>) => Promise<T>;
  counter: (name: string, value?: number, labels?: SafeAttributes) => void;
  gauge: (name: string, value: number, labels?: SafeAttributes) => void;
  histogram: (name: string, value: number, unit?: string, labels?: SafeAttributes) => void;
  captureError: (error: unknown, attrs?: SafeAttributes, remote?: boolean) => void;
  markStartup: (phase: string, attrs?: SafeAttributes) => void;
  configure: (preferences: ObservabilityPreferences) => void;
  getSnapshot: () => ObservabilitySnapshot;
  refreshSnapshot: () => Promise<ObservabilitySnapshot>;
  subscribe: (listener: () => void) => () => void;
  initialize: () => Promise<void>;
  shutdown: () => Promise<void>;
  clearLocal: () => Promise<void>;
  exportReport: (options: ExportOptions) => Promise<ExportResult>;
  flush: () => Promise<void>;
};
