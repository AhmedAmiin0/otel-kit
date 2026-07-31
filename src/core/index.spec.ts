import * as core from './index';

const EXPECTED_EXPORTS = [
  'defineConfig',
  'defaults',
  'DEFAULT_REDACTION_KEYS',
  'fromEnv',
  'isTrue',
  'commaStringToList',
  'commaStringToLowerSet',
  'intFromEnv',
  'deepMerge',
  'createDiagnostics',
  'noopLogger',
  'createConsoleLogger',
  'getTracer',
  'getMeter',
  'setTelemetryConfig',
  'resetTelemetryHandles',
  'withSpan',
  'getRequestContext',
  'Telemetry',
  'redactBody',
  'serializeBody',
  'redactAndSerialize',
  'buildSerializers',
  'sanitizeHeaders',
  'httpLogLevel',
  'storeCapturedBody',
  'readCapturedBody',
];

/** Packages core must never pull in. This is the dependency boundary, as a test. */
const FORBIDDEN = ['@nestjs', 'pino', 'nestjs-pino', 'axios', 'dotenv'];

/** Windows reports backslash paths; compare on a single separator. */
const loadedModules = (): string[] =>
  Object.keys(require.cache).map((path) => path.replace(/\\/g, '/'));

describe('core barrel', () => {
  it('exports the documented surface', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(core).toHaveProperty(name);
    }
  });

  it('loads no framework or logging package', () => {
    const loaded = loadedModules().filter((path) => path.includes('node_modules'));

    // Guard against the assertion passing vacuously: if the module registry is
    // empty, the check below proves nothing.
    expect(loaded.length).toBeGreaterThan(0);

    const offenders = loaded.filter((path) =>
      FORBIDDEN.some((pkg) => path.includes(`node_modules/${pkg}/`)),
    );
    expect(offenders).toEqual([]);
  });

  it('loads @opentelemetry/api and nothing else from the SDK', () => {
    const otel = loadedModules()
      .filter((path) => path.includes('@opentelemetry/'))
      .filter((path) => !path.includes('@opentelemetry/api/'));
    expect(otel).toEqual([]);
  });
});
