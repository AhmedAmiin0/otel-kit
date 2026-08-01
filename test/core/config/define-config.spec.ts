import { defineConfig } from '../../../src/core/config/define-config';

describe('defineConfig', () => {
  it('produces a usable config from an empty environment', () => {
    const cfg = defineConfig({}, {});
    expect(cfg.service.name).toBe('unknown-service');
    expect(cfg.traces.exporter).toBe('otlp-http');
    expect(cfg.metrics.exportIntervalMs).toBe(5000);
    expect(cfg.logging.excludeRoutes).toEqual(['/health', '/health-check', '/metrics']);
  });

  it('lets the environment override a default', () => {
    expect(defineConfig({}, { LOG_LEVEL: 'warn' }).logging.level).toBe('warn');
  });

  it('lets a programmatic override beat the environment', () => {
    const cfg = defineConfig({ logging: { level: 'debug' } }, { LOG_LEVEL: 'warn' });
    expect(cfg.logging.level).toBe('debug');
  });

  it('keeps sibling keys when a nested override is supplied', () => {
    const cfg = defineConfig({ logging: { level: 'debug' } }, {});
    expect(cfg.logging.headers).toBe(true);
    expect(cfg.logging.correlationIdHeader).toBe('x-request-id');
  });

  it('normalizes redaction keys to a lowercased Set', () => {
    const cfg = defineConfig({ redaction: { keys: ['Password', 'TOKEN'] } }, {});
    expect(cfg.redaction.keys).toBeInstanceOf(Set);
    expect(cfg.redaction.keys.has('password')).toBe(true);
    expect(cfg.redaction.keys.has('token')).toBe(true);
  });

  it('normalizes redaction keys arriving from the environment', () => {
    const cfg = defineConfig({}, { LOG_RESPONSE_BODY_REDACT: 'Secret,ApiKey' });
    expect(cfg.redaction.keys).toBeInstanceOf(Set);
    expect(cfg.redaction.keys.has('secret')).toBe(true);
    expect(cfg.redaction.keys.has('apikey')).toBe(true);
  });

  it('ships the documented default redaction keys', () => {
    const cfg = defineConfig({}, {});
    for (const key of [
      'password',
      'token',
      'secret',
      'accesstoken',
      'refreshtoken',
      'apikey',
      'authorization',
    ]) {
      expect(cfg.redaction.keys.has(key)).toBe(true);
    }
  });

  it('defaults pretty logging off when NODE_ENV is production', () => {
    expect(defineConfig({}, { NODE_ENV: 'production' }).logging.pretty).toBe(false);
    expect(defineConfig({}, { NODE_ENV: 'development' }).logging.pretty).toBe(true);
  });

  it('reads process.env when no environment is passed', () => {
    process.env['OTEL_SERVICE_NAME'] = 'from-real-env';
    try {
      expect(defineConfig().service.name).toBe('from-real-env');
    } finally {
      delete process.env['OTEL_SERVICE_NAME'];
    }
  });

  it('passes an exporter instance through untouched', () => {
    const exporter = { export: () => undefined, shutdown: async () => undefined };
    expect(defineConfig({ traces: { exporter } }, {}).traces.exporter).toBe(exporter);
  });

  it('does not mutate the overrides it is given', () => {
    const overrides = { logging: { level: 'debug' } };
    defineConfig(overrides, {});
    expect(overrides).toEqual({ logging: { level: 'debug' } });
  });
});
