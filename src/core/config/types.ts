export type { Instrumentation } from './instrumentation-shim';

export type DiagnosticLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

export interface ServiceConfig {
  name: string;
  version: string;
  environment?: string;
}

export interface RedactionConfig {
  keys: Set<string>;
  placeholder: string;
  bodyMaxChars: number;
  maxDepth: number;
}

export interface LoggingConfig {
  level: string;
  pretty: boolean;
  quietRequestLogger: boolean;
  headers: boolean;
  requestBody: boolean;
  responseBody: boolean;
  httpClient: boolean;
  kafka: boolean;
  kafkaBody: boolean;
  kafkaHeaders: boolean;
  excludeRoutes: string[];
  excludeTopics: string[];
  correlationIdHeader: string;
}

/**
 * `exporter` is deliberately `unknown` in core: its concrete union references
 * SDK types that only src/node/ may import. src/node/exporters narrows it at
 * the point of use.
 */
export interface TracesConfig {
  exporter: unknown;
  endpoint?: string;
  ignoreRoutes: string[];
}

export interface MetricsConfig {
  exporter: unknown;
  endpoint?: string;
  exportIntervalMs: number;
  port: number;
}

export interface LogsConfig {
  exporter: unknown;
  endpoint?: string;
}

export interface ObservabilityConfig {
  service: ServiceConfig;
  resource: { attributes: Record<string, string> };
  traces: TracesConfig;
  metrics: MetricsConfig;
  logs: LogsConfig;
  instrumentations: Record<string, unknown>;
  logging: LoggingConfig;
  redaction: RedactionConfig;
  diagnostics: { level: DiagnosticLevel };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * What a consumer hand-writes. Differs from the resolved config in that
 * redaction keys arrive as a plain string[] and are normalized to a
 * lowercased Set during resolution.
 */
export interface ObservabilityConfigInput
  extends DeepPartial<Omit<ObservabilityConfig, 'redaction' | 'instrumentations'>> {
  redaction?: Partial<Omit<RedactionConfig, 'keys'>> & { keys?: string[] };
  instrumentations?: Record<string, unknown>;
}
