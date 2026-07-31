describe('register entry', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      OTEL_TRACES_EXPORTER: 'console',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_LOGS_EXPORTER: 'none',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('starts without throwing when no collector is running', () => {
    expect(() => require('./register')).not.toThrow();
  });

  it('exposes the started handle', () => {
    const mod = require('./register') as { handle: { sdk: unknown } };
    expect(mod.handle.sdk).toBeDefined();
  });

  // A library must not mutate the host application's environment. This is the
  // executable form of that rule, replacing require('dotenv').config() at
  // src/bootstrap.ts:1.
  it('does not load dotenv', () => {
    require('./register');
    const loaded = Object.keys(require.cache).map((p) => p.replace(/\\/g, '/'));
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.filter((p) => p.includes('node_modules/dotenv/'))).toEqual([]);
  });
});
