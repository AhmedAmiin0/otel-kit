import type { Diagnostics } from '../../core/diagnostics';
import {
  canResolve as defaultCanResolve,
  requireOptional as defaultRequireOptional,
} from '../resolve';
import type { ExporterDeps } from './signals';

const DEFAULT_DEPS: ExporterDeps = {
  canResolve: defaultCanResolve,
  requireOptional: defaultRequireOptional,
};

/** Push exporters, which must be wrapped in a reader before NodeSDK accepts them. */
const PUSH_EXPORTERS: Record<string, [string, string]> = {
  'otlp-http': ['@opentelemetry/exporter-metrics-otlp-http', 'OTLPMetricExporter'],
  'otlp-grpc': ['@opentelemetry/exporter-metrics-otlp-grpc', 'OTLPMetricExporter'],
  'otlp-proto': ['@opentelemetry/exporter-metrics-otlp-proto', 'OTLPMetricExporter'],
  console: ['@opentelemetry/sdk-metrics', 'ConsoleMetricExporter'],
};

const SDK_METRICS = '@opentelemetry/sdk-metrics';
const PROMETHEUS = '@opentelemetry/exporter-prometheus';
const DEFAULT_PROMETHEUS_PORT = 9464;
const DEFAULT_EXPORT_INTERVAL_MS = 5000;

export interface MetricOptions {
  endpoint?: string;
  exportIntervalMs?: number;
  port?: number;
}

const load = (
  module: string,
  exportName: string,
  deps: ExporterDeps,
): new (o: unknown) => unknown => {
  if (!deps.canResolve(module)) {
    throw new Error(
      `[observability] metric exporter requires ${module}, which is not installed. ` +
        `Run \`npm install ${module}\`, or set metrics.exporter to "console" or "none".`,
    );
  }

  const bag = deps.requireOptional(module) as Record<string, unknown> | undefined;
  const Ctor = bag?.[exportName];

  if (typeof Ctor !== 'function') {
    throw new TypeError(`[observability] ${module} does not export ${exportName}`);
  }

  return Ctor as new (o: unknown) => unknown;
};

const buildNamed = (name: string, options: MetricOptions, deps: ExporterDeps): unknown => {
  // PrometheusExporter IS a MetricReader and serves /metrics itself. Wrapping
  // it in a PeriodicExportingMetricReader would produce a reader that never
  // serves anything.
  if (name === 'prometheus') {
    const Ctor = load(PROMETHEUS, 'PrometheusExporter', deps);
    return new Ctor({ port: options.port ?? DEFAULT_PROMETHEUS_PORT });
  }

  const entry = PUSH_EXPORTERS[name];
  if (!entry) {
    throw new Error(
      `[observability] unknown metric exporter "${name}". ` +
        `Valid names: ${Object.keys(PUSH_EXPORTERS).join(', ')}, prometheus, none`,
    );
  }

  const Exporter = load(entry[0], entry[1], deps);
  const Reader = load(SDK_METRICS, 'PeriodicExportingMetricReader', deps);

  return new Reader({
    exporter: new Exporter(options.endpoint ? { url: options.endpoint } : {}),
    exportIntervalMillis: options.exportIntervalMs ?? DEFAULT_EXPORT_INTERVAL_MS,
  });
};

/**
 * Metrics are separate from traces and logs because NodeSDK wants readers,
 * not exporters.
 */
export const resolveMetricReaders = (
  spec: unknown,
  options: MetricOptions,
  diag: Diagnostics,
  deps: ExporterDeps = DEFAULT_DEPS,
): unknown[] => {
  if (Array.isArray(spec)) {
    return spec.flatMap((entry) => resolveMetricReaders(entry, options, diag, deps));
  }

  if (spec === 'none' || spec === undefined) return [];

  if (typeof spec === 'string') {
    const reader = buildNamed(spec, options, deps);
    diag.debug(`metric reader ${spec} ready`);
    return [reader];
  }

  if (typeof spec === 'function') return [(spec as () => unknown)()];
  if (typeof spec === 'object' && spec !== null) return [spec];

  throw new Error(`[observability] unsupported metric exporter specification: ${String(spec)}`);
};
