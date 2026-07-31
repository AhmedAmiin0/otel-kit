export type NamedExporter = 'otlp-http' | 'otlp-grpc' | 'otlp-proto' | 'console' | 'none';

export type NamedMetricExporter = NamedExporter | 'prometheus';

/** A spec is a name, a live instance, a factory, or an array of those. */
export type ExporterSpec<T> =
  | NamedExporter
  | T
  | (() => T)
  | Array<NamedExporter | T | (() => T)>;

export interface ExporterOptions {
  endpoint?: string;
}

/** Package and named export per signal, so a missing package names itself. */
export type ExporterModuleTable = Record<Exclude<NamedExporter, 'none'>, [string, string]>;

export const TRACE_EXPORTERS: ExporterModuleTable = {
  'otlp-http': ['@opentelemetry/exporter-trace-otlp-http', 'OTLPTraceExporter'],
  'otlp-grpc': ['@opentelemetry/exporter-trace-otlp-grpc', 'OTLPTraceExporter'],
  'otlp-proto': ['@opentelemetry/exporter-trace-otlp-proto', 'OTLPTraceExporter'],
  // sdk-trace-base is already a transitive requirement of sdk-node, so the
  // console path costs no additional install. This is what lets a bare
  // install produce visible output with no collector running.
  console: ['@opentelemetry/sdk-trace-base', 'ConsoleSpanExporter'],
};

export const LOG_EXPORTERS: ExporterModuleTable = {
  'otlp-http': ['@opentelemetry/exporter-logs-otlp-http', 'OTLPLogExporter'],
  'otlp-grpc': ['@opentelemetry/exporter-logs-otlp-grpc', 'OTLPLogExporter'],
  'otlp-proto': ['@opentelemetry/exporter-logs-otlp-proto', 'OTLPLogExporter'],
  console: ['@opentelemetry/sdk-logs', 'ConsoleLogRecordExporter'],
};
