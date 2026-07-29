import { registerAs } from '@nestjs/config';
import { commaStringToList, commaStringToLowerSet, intFromEnv, isTrue } from './helpers';

const env = process.env;
const excludeRoutes = commaStringToList(env.LOG_EXCLUDE_ROUTES ?? '/health,/health-check,/metrics');

const defaultRedactKeys = ['password,token,secret,accessToken,refreshToken,apiKey,authorization'].join(',');

export const OBSERVABILITY_NAMESPACE = 'observability';

const config = {
  namespace: OBSERVABILITY_NAMESPACE,
  service: {
    name: env.OTEL_SERVICE_NAME?.trim() || env.MS_NAME?.trim() || 'unknown-service',
    version: env.OTEL_SERVICE_VERSION ?? '0.0.1',
  },
  logging: {
    level: env.LOG_LEVEL ?? 'info',
    pretty: isTrue(env.LOG_PRETTY, env.NODE_ENV !== 'production'),
    quietRequestLogger: isTrue(env.LOG_QUIET_REQ, true),
    headers: isTrue(env.LOG_HEADERS, true),
    requestBody: isTrue(env.LOG_REQUEST_BODY, true),
    responseBody: isTrue(env.LOG_RESPONSE_BODY, true),
    httpClient: isTrue(env.LOG_HTTP_CLIENT, true),
    kafka: isTrue(env.LOG_KAFKA, true),
    kafkaBody: isTrue(env.LOG_KAFKA_BODY, true),
    kafkaHeaders: isTrue(env.LOG_KAFKA_HEADERS, true),
    excludeRoutes,
    excludeTopics: commaStringToList(env.LOG_EXCLUDE_TOPICS ?? ''),
    correlationIdHeader: (env.LOG_CORRELATION_HEADER ?? 'x-request-id').toLowerCase(),
  },
  redaction: {
    keys: commaStringToLowerSet(env.LOG_RESPONSE_BODY_REDACT ?? defaultRedactKeys),
    placeholder: env.LOG_REDACTED ?? 'XXXXXXXXXXXXXXXX',
    bodyMaxChars: intFromEnv(env.LOG_BODY_MAX_CHARS, 500),
    maxDepth: intFromEnv(env.LOG_BODY_MAX_DEPTH, 8),
  },
  tracing: {
    ignoreRoutes: env.OTEL_IGNORE_ROUTES ? commaStringToList(env.OTEL_IGNORE_ROUTES) : excludeRoutes,
    metricExportIntervalMs: intFromEnv(env.OTEL_METRIC_EXPORT_INTERVAL, 5000),
    typeorm: {
      enabled: isTrue(env.OTEL_TYPEORM_ENABLED, false),
    },
    kafkajs: {
      enabled: isTrue(env.OTEL_KAFKAJS_ENABLED, true),
    },
  },
};

type ObservabilityConfig = typeof config;
export const loadObservabilityConfig = (options = {}): ObservabilityConfig => ({
  ...config,
  ...options,
});

export const observabilityConfig = registerAs(OBSERVABILITY_NAMESPACE, loadObservabilityConfig);

export type { ObservabilityConfig };
export default config;
