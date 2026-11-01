import { Directory, File, Paths } from 'expo-file-system';
import { strToU8, zipSync } from 'fflate';

import { sanitizeRecord } from '@/shared/observability/sanitize';
import type {
  BuildMetadata,
  DiagnosticRecord,
  ExportOptions,
  ExportResult,
  ObservabilityKind,
  ObservabilityPreferences,
} from '@/shared/observability/types';
import type { DiagnosticsStore } from '@/shared/observability/storage/jsonl-store';

export const EXPORT_SCHEMA_VERSION = 1;
const EXPORT_MAX_RECORDS = 5000;

const README = `OpenCode Mobile diagnostic report

This archive is generated locally on your device. It is never uploaded
automatically. It contains sanitized structured logs, spans, metrics and
errors, plus app/build metadata. Prompts, responses, source code, terminal
output, server URLs, credentials and file paths are not intentionally included.

Review the files before sharing them with a maintainer.
`;

function countKinds(records: DiagnosticRecord[]) {
  const counts: Record<ObservabilityKind, number> = { log: 0, span: 0, metric: 0, error: 0 };
  for (const record of records) counts[record.kind] += 1;
  return counts;
}

function jsonLines(records: DiagnosticRecord[]) {
  return records.map((record) => JSON.stringify(sanitizeRecord(record))).join('\n');
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export type BuildReportInput = {
  store: DiagnosticsStore;
  build: BuildMetadata;
  preferences: ObservabilityPreferences;
  options: ExportOptions;
};

function cleanupStaleExports(now = Date.now()) {
  try {
    const cache = new Directory(Paths.cache);
    if (!cache.exists) return;
    for (const entry of cache.list()) {
      if (!(entry instanceof File) || !entry.name.startsWith('opencode-diagnostics-') || !entry.name.endsWith('.zip')) continue;
      const modified = entry.modificationTime ?? 0;
      if (now - modified > 10 * 60 * 1000) entry.delete();
    }
  } catch {
    // Cache cleanup is best-effort.
  }
}

export async function buildDiagnosticReport({ store, build, preferences, options }: BuildReportInput) {
  cleanupStaleExports();
  const records = await store.read(EXPORT_MAX_RECORDS);
  const counts = countKinds(records);
  const usage = await store.usage();
  const now = Date.now();
  const manifest = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    app: {
      version: build.appVersion,
      build: build.buildNumber,
      variant: build.variant,
      environment: build.environment,
    },
    device: {
      platform: build.platform,
      osVersion: build.osVersion ?? undefined,
    },
    preferences: {
      localDiagnostics: preferences.diagnosticsEnabled,
      level: preferences.diagnosticsLevel,
      remoteTelemetry: preferences.remoteTelemetryEnabled,
      remoteCrashReports: preferences.remoteCrashReports,
      remotePerformance: preferences.remotePerformance,
    },
    storage: { ...usage, bytesLabel: formatBytes(usage.bytes) },
    counts,
    includesDetails: options.includeDetails,
    privacy: {
      redaction: 'allowlist-v1',
      excluded: [
        'prompts', 'responses', 'transcripts', 'source code', 'diffs',
        'file contents', 'terminal output', 'credentials', 'auth headers',
        'server URLs', 'hostnames', 'filesystem paths', 'request bodies',
        'cloud link tokens', 'notification content', 'personal data',
      ],
    },
  };

  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    'README.txt': strToU8(README),
  };
  if (options.includeDetails) {
    const byKind = (kind: ObservabilityKind) => records.filter((record) => record.kind === kind).reverse();
    files['logs.jsonl'] = strToU8(`${jsonLines(byKind('log'))}\n`);
    files['spans.jsonl'] = strToU8(`${jsonLines(byKind('span'))}\n`);
    files['metrics.jsonl'] = strToU8(`${jsonLines(byKind('metric'))}\n`);
    files['errors.jsonl'] = strToU8(`${jsonLines(byKind('error'))}\n`);
  }

  const archive = zipSync(files, { level: 6 });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const fileName = `opencode-diagnostics-${stamp}.zip`;
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create({ intermediates: true });
  await file.write(archive);
  return { file, fileName, bytes: archive.byteLength, counts };
}

export async function writeDiagnosticReport(input: BuildReportInput): Promise<ExportResult> {
  const result = await buildDiagnosticReport(input);
  return {
    uri: result.file.uri,
    bytes: result.bytes,
    fileName: result.fileName,
    counts: result.counts,
  };
}
