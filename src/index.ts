export { ObservabilityModule } from './observability.module';
export { TelemetryService } from './tracing/telemetry.service';
export { meter, tracer, withSpan } from './tracing/tracer';
export { HttpClientLogger } from './logging/http-client.logger';
export { useObservabilityLogger } from './logging/use-logger';


export {
  default as observabilityDefaults,
  loadObservabilityConfig,
  OBSERVABILITY_NAMESPACE,
  type ObservabilityConfig,
} from './config';

export {
  RequestExceptionFilter,
  errorResponseBody,
} from './logging/request-exception.filter';
export { RequestBodyInterceptor } from './logging/request-body.interceptor';
export { readCapturedBody, storeCapturedBody } from './logging/body-capture';
export {
  redactAndSerialize,
  redactBody,
  serializeBody,
} from './logging/redact';
