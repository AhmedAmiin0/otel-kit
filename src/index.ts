export { ObservabilityModule } from './observability.module';
export { TelemetryService } from './tracing/telemetry.service';
export { HttpClientLogger } from './logging/http-client.logger';
export { useObservabilityLogger } from './logging/use-logger';

export { withSpan, getRequestContext } from './core/telemetry/spans';
export { getTracer, getMeter, setTelemetryConfig } from './core/telemetry/handles';

export {
  default as observabilityDefaults,
  loadObservabilityConfig,
  OBSERVABILITY_NAMESPACE,
  type ObservabilityConfig,
} from './config';
export { defineConfig } from './core/config/define-config';
export type { ObservabilityConfigInput } from './core/config/types';

export {
  RequestExceptionFilter,
  errorResponseBody,
} from './logging/request-exception.filter';
export { RequestBodyInterceptor } from './logging/request-body.interceptor';
export { readCapturedBody, storeCapturedBody } from './core/redaction/body-capture';
export {
  redactAndSerialize,
  redactBody,
  serializeBody,
} from './core/redaction/redact';
