import { fromEnv, isTrue, commaStringToList, intFromEnv } from '../../../src/core/config/env';

describe('helpers', () => {
  it('parses truthy strings case-insensitively', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
      expect(isTrue(v, false)).toBe(true);
    }
  });

  it('returns the fallback only for undefined', () => {
    expect(isTrue(undefined, true)).toBe(true);
    expect(isTrue('', true)).toBe(false);
    expect(isTrue('nonsense', true)).toBe(false);
  });

  it('splits and trims comma lists, dropping empties', () => {
    expect(commaStringToList(' a , ,b ,')).toEqual(['a', 'b']);
  });

  it('falls back when an int cannot be parsed', () => {
    expect(intFromEnv('42', 7)).toBe(42);
    expect(intFromEnv('abc', 7)).toBe(7);
    expect(intFromEnv(undefined, 7)).toBe(7);
  });
});

describe('fromEnv', () => {
  it('returns an empty object when nothing is set', () => {
    expect(fromEnv({})).toEqual({});
  });

  it('prefers OTEL_SERVICE_NAME over MS_NAME', () => {
    const result = fromEnv({ OTEL_SERVICE_NAME: 'a', MS_NAME: 'b' });
    expect(result.service?.name).toBe('a');
  });

  it('falls back to MS_NAME', () => {
    expect(fromEnv({ MS_NAME: 'b' }).service?.name).toBe('b');
  });

  it('ignores a whitespace-only service name', () => {
    expect(fromEnv({ OTEL_SERVICE_NAME: '   ', MS_NAME: 'b' }).service?.name).toBe('b');
  });

  it('omits keys that are not set rather than emitting undefined', () => {
    const result = fromEnv({ LOG_LEVEL: 'debug' });
    expect(result.logging).toEqual({ level: 'debug' });
    expect('traces' in result).toBe(false);
  });

  it('reads redaction keys as an array', () => {
    expect(fromEnv({ LOG_RESPONSE_BODY_REDACT: 'a,B' }).redaction?.keys).toEqual(['a', 'B']);
  });

  it('maps OTEL_IGNORE_ROUTES to traces.ignoreRoutes', () => {
    expect(fromEnv({ OTEL_IGNORE_ROUTES: '/a,/b' }).traces?.ignoreRoutes).toEqual(['/a', '/b']);
  });

  it('defaults traces.ignoreRoutes to the log exclusion list', () => {
    expect(fromEnv({ LOG_EXCLUDE_ROUTES: '/x' }).traces?.ignoreRoutes).toEqual(['/x']);
  });

  it('keeps a configured zero rather than dropping it', () => {
    expect(fromEnv({ OTEL_METRIC_EXPORT_INTERVAL: '0' }).metrics?.exportIntervalMs).toBe(0);
  });

  it('translates the legacy per-instrumentation enable flags', () => {
    const result = fromEnv({ OTEL_TYPEORM_ENABLED: 'true', OTEL_KAFKAJS_ENABLED: 'false' });
    expect(result.instrumentations).toEqual({
      typeorm: { enabled: true },
      kafkajs: { enabled: false },
    });
  });

  it('reads the instrumentation allow and deny lists', () => {
    const result = fromEnv({
      OTEL_INSTRUMENTATIONS: 'http,pg',
      OTEL_INSTRUMENTATIONS_DISABLED: 'fs',
    });
    expect(result.instrumentations).toEqual({
      http: { enabled: true, explicit: true },
      pg: { enabled: true, explicit: true },
      fs: { enabled: false },
    });
  });
});
