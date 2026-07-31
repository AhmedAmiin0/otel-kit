export { defineConfig } from './config/define-config';
export { defaults, DEFAULT_REDACTION_KEYS } from './config/defaults';
export {
  fromEnv,
  isTrue,
  commaStringToList,
  commaStringToLowerSet,
  intFromEnv,
} from './config/env';
export { deepMerge } from './config/merge';
export type {
  ObservabilityConfig,
  ObservabilityConfigInput,
  DiagnosticLevel,
  LoggingConfig,
  RedactionConfig,
  ServiceConfig,
  TracesConfig,
  MetricsConfig,
  LogsConfig,
  Instrumentation,
} from './config/types';

export { createDiagnostics } from './diagnostics';
export type { Diagnostics, DiagnosticSink, EmittableLevel } from './diagnostics';

export { noopLogger } from './logger/noop';
export { createConsoleLogger } from './logger/console';
export type { ObsLogger } from './logger/types';

export {
  getTracer,
  getMeter,
  setTelemetryConfig,
  resetTelemetryHandles,
} from './telemetry/handles';
export { withSpan, getRequestContext } from './telemetry/spans';
export { Telemetry } from './telemetry/telemetry';

export { redactBody, serializeBody, redactAndSerialize } from './redaction/redact';
export {
  buildSerializers,
  serializeRequest,
  serializeResponse,
  sanitizeHeaders,
  httpLogLevel,
} from './redaction/serializers';
export type { SerializerConfig } from './redaction/serializers';
export { buildRequestLog, logRequest } from './logger/request-logger';
export type { RequestLogConfig } from './logger/request-logger';
export { storeCapturedBody, readCapturedBody } from './redaction/body-capture';
