import type { ObservabilityConfig } from './types';

export const DEFAULT_REDACTION_KEYS = [
  'password',
  'token',
  'secret',
  'accessToken',
  'refreshToken',
  'apiKey',
  'authorization',
];

const DEFAULT_EXCLUDED_ROUTES = ['/health', '/health-check', '/metrics'];

export const defaults = (env: NodeJS.ProcessEnv): ObservabilityConfig => ({
  service: { name: 'unknown-service', version: '0.0.1' },
  resource: { attributes: {} },
  traces: { exporter: 'otlp-http', ignoreRoutes: [...DEFAULT_EXCLUDED_ROUTES] },
  metrics: { exporter: 'otlp-http', exportIntervalMs: 5000, port: 9464 },
  logs: { exporter: 'otlp-http' },
  instrumentations: {},
  logging: {
    level: 'info',
    pretty: env.NODE_ENV !== 'production',
    quietRequestLogger: true,
    headers: true,
    requestBody: true,
    responseBody: true,
    httpClient: true,
    kafka: true,
    kafkaBody: true,
    kafkaHeaders: true,
    excludeRoutes: [...DEFAULT_EXCLUDED_ROUTES],
    excludeTopics: [],
    correlationIdHeader: 'x-request-id',
  },
  redaction: {
    keys: new Set(DEFAULT_REDACTION_KEYS.map((key) => key.toLowerCase())),
    placeholder: 'XXXXXXXXXXXXXXXX',
    bodyMaxChars: 500,
    maxDepth: 8,
  },
  diagnostics: { level: 'none' },
});
