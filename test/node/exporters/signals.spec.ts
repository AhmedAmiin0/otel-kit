import { resolveTraceExporters, resolveLogExporters, type ExporterDeps } from '../../../src/node/exporters/signals';
import { createDiagnostics } from '../../../src/core/diagnostics';

const diag = createDiagnostics('none');

class FakeExporter {
  constructor(public readonly opts: unknown) {}
  export = (): void => undefined;
  shutdown = async (): Promise<void> => undefined;
}

const TRACE_MODULES = [
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/exporter-trace-otlp-grpc',
  '@opentelemetry/exporter-trace-otlp-proto',
  '@opentelemetry/sdk-trace-base',
];

const deps = (present: string[]): ExporterDeps => ({
  canResolve: (id: string) => present.includes(id),
  requireOptional: () => ({
    OTLPTraceExporter: FakeExporter,
    ConsoleSpanExporter: FakeExporter,
    OTLPLogExporter: FakeExporter,
    ConsoleLogRecordExporter: FakeExporter,
  }),
});

describe('resolveTraceExporters', () => {
  it('returns nothing for the none spec', () => {
    expect(resolveTraceExporters('none', {}, diag, deps(TRACE_MODULES))).toEqual([]);
  });

  it('returns nothing when the spec is undefined', () => {
    expect(resolveTraceExporters(undefined, {}, diag, deps(TRACE_MODULES))).toEqual([]);
  });

  it.each(['otlp-http', 'otlp-grpc', 'otlp-proto', 'console'])('builds a %s exporter', (spec) => {
    expect(resolveTraceExporters(spec, {}, diag, deps(TRACE_MODULES))).toHaveLength(1);
  });

  it('passes the endpoint through to the exporter options', () => {
    const [made] = resolveTraceExporters(
      'otlp-http',
      { endpoint: 'http://x:4318' },
      diag,
      deps(TRACE_MODULES),
    );
    expect((made as FakeExporter).opts).toMatchObject({ url: 'http://x:4318' });
  });

  it('fans out an array spec to several exporters', () => {
    expect(
      resolveTraceExporters(['console', 'otlp-http'], {}, diag, deps(TRACE_MODULES)),
    ).toHaveLength(2);
  });

  it('passes a supplied exporter instance through untouched', () => {
    const instance = new FakeExporter({});
    expect(resolveTraceExporters(instance, {}, diag, deps(TRACE_MODULES))[0]).toBe(instance);
  });

  it('calls a supplied factory and uses its result', () => {
    const instance = new FakeExporter({});
    expect(resolveTraceExporters(() => instance, {}, diag, deps(TRACE_MODULES))[0]).toBe(instance);
  });

  it('throws when the requested exporter package is missing', () => {
    expect(() => resolveTraceExporters('otlp-grpc', {}, diag, deps([]))).toThrow(
      /@opentelemetry\/exporter-trace-otlp-grpc/,
    );
  });

  it('names the install command when the package is missing', () => {
    expect(() => resolveTraceExporters('otlp-grpc', {}, diag, deps([]))).toThrow(/npm install/);
  });

  it('throws on an unknown exporter name', () => {
    expect(() => resolveTraceExporters('carrier-pigeon', {}, diag, deps(TRACE_MODULES))).toThrow(
      /carrier-pigeon/,
    );
  });

  it('resolves console without any otlp package installed', () => {
    expect(
      resolveTraceExporters('console', {}, diag, deps(['@opentelemetry/sdk-trace-base'])),
    ).toHaveLength(1);
  });
});

describe('resolveLogExporters', () => {
  it('builds an otlp-http log exporter', () => {
    expect(
      resolveLogExporters('otlp-http', {}, diag, deps(['@opentelemetry/exporter-logs-otlp-http'])),
    ).toHaveLength(1);
  });

  it('returns nothing for none', () => {
    expect(resolveLogExporters('none', {}, diag, deps([]))).toEqual([]);
  });

  it('throws naming the log exporter package when missing', () => {
    expect(() => resolveLogExporters('otlp-grpc', {}, diag, deps([]))).toThrow(
      /@opentelemetry\/exporter-logs-otlp-grpc/,
    );
  });
});
