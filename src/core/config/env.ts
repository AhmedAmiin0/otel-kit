import type { ObservabilityConfigInput } from './types';

export const isTrue = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : /^(1|true|yes|on)$/i.test(value.trim());

export const commaStringToList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const commaStringToLowerSet = (value: string): Set<string> =>
  new Set(commaStringToList(value).map((entry) => entry.toLowerCase()));

export const intFromEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/** Assigns only when `value` is defined, so an unset env var leaves no key behind. */
const put = <T>(target: Record<string, unknown>, key: string, value: T | undefined): void => {
  if (value !== undefined) target[key] = value;
};

/** Adds a config section only if at least one of its keys was set. */
const section = (
  out: Record<string, unknown>,
  name: string,
  build: (bag: Record<string, unknown>) => void,
): void => {
  const bag: Record<string, unknown> = {};
  build(bag);
  if (Object.keys(bag).length > 0) out[name] = bag;
};

const bool = (raw: string | undefined): boolean | undefined =>
  raw === undefined ? undefined : isTrue(raw, false);

const list = (raw: string | undefined): string[] | undefined =>
  raw === undefined ? undefined : commaStringToList(raw);

const int = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  // Must not use `|| undefined` here — that would silently drop a configured 0.
  return Number.isNaN(parsed) ? undefined : parsed;
};

export const fromEnv = (env: NodeJS.ProcessEnv): ObservabilityConfigInput => {
  const out: Record<string, unknown> = {};

  section(out, 'service', (s) => {
    put(s, 'name', env.OTEL_SERVICE_NAME?.trim() || env.MS_NAME?.trim() || undefined);
    put(s, 'version', env.OTEL_SERVICE_VERSION);
    put(s, 'environment', env.OTEL_ENVIRONMENT ?? env.NODE_ENV);
  });

  section(out, 'logging', (l) => {
    put(l, 'level', env.LOG_LEVEL);
    put(l, 'pretty', bool(env.LOG_PRETTY));
    put(l, 'quietRequestLogger', bool(env.LOG_QUIET_REQ));
    put(l, 'headers', bool(env.LOG_HEADERS));
    put(l, 'requestBody', bool(env.LOG_REQUEST_BODY));
    put(l, 'responseBody', bool(env.LOG_RESPONSE_BODY));
    put(l, 'httpClient', bool(env.LOG_HTTP_CLIENT));
    put(l, 'kafka', bool(env.LOG_KAFKA));
    put(l, 'kafkaBody', bool(env.LOG_KAFKA_BODY));
    put(l, 'kafkaHeaders', bool(env.LOG_KAFKA_HEADERS));
    put(l, 'excludeRoutes', list(env.LOG_EXCLUDE_ROUTES));
    put(l, 'excludeTopics', list(env.LOG_EXCLUDE_TOPICS));
    put(l, 'correlationIdHeader', env.LOG_CORRELATION_HEADER?.toLowerCase());
  });

  section(out, 'redaction', (r) => {
    put(r, 'keys', list(env.LOG_RESPONSE_BODY_REDACT));
    put(r, 'placeholder', env.LOG_REDACTED);
    put(r, 'bodyMaxChars', int(env.LOG_BODY_MAX_CHARS));
    put(r, 'maxDepth', int(env.LOG_BODY_MAX_DEPTH));
    put(r, 'maxNodes', int(env.LOG_BODY_MAX_NODES));
  });

  section(out, 'traces', (t) => {
    put(t, 'exporter', env.OTEL_TRACES_EXPORTER);
    put(t, 'endpoint', env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
    // OTEL_IGNORE_ROUTES wins; otherwise reuse the log exclusion list, matching src/config.ts:38.
    put(t, 'ignoreRoutes', list(env.OTEL_IGNORE_ROUTES) ?? list(env.LOG_EXCLUDE_ROUTES));
  });

  section(out, 'metrics', (m) => {
    put(m, 'exporter', env.OTEL_METRICS_EXPORTER);
    put(m, 'endpoint', env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT);
    put(m, 'exportIntervalMs', int(env.OTEL_METRIC_EXPORT_INTERVAL));
    put(m, 'port', int(env.OTEL_PROMETHEUS_PORT));
  });

  section(out, 'logs', (l) => {
    put(l, 'exporter', env.OTEL_LOGS_EXPORTER);
    put(l, 'endpoint', env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT);
  });

  section(out, 'diagnostics', (d) => {
    put(d, 'level', env.OTEL_DIAG_LEVEL);
  });

  const instrumentations: Record<string, unknown> = {};
  for (const name of commaStringToList(env.OTEL_INSTRUMENTATIONS ?? '')) {
    instrumentations[name] = { enabled: true, explicit: true };
  }
  for (const name of commaStringToList(env.OTEL_INSTRUMENTATIONS_DISABLED ?? '')) {
    instrumentations[name] = { enabled: false };
  }

  // Legacy flags from src/config.ts:41-46, kept working per the migration plan.
  const typeorm = bool(env.OTEL_TYPEORM_ENABLED);
  if (typeorm !== undefined) instrumentations['typeorm'] = { enabled: typeorm };
  const kafkajs = bool(env.OTEL_KAFKAJS_ENABLED);
  if (kafkajs !== undefined) instrumentations['kafkajs'] = { enabled: kafkajs };

  if (Object.keys(instrumentations).length > 0) out['instrumentations'] = instrumentations;

  return out as ObservabilityConfigInput;
};
