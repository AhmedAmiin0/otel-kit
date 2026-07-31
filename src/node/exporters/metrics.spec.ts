import { resolveMetricReaders } from './metrics';
import { createDiagnostics } from '../../core/diagnostics';
import type { ExporterDeps } from './signals';

const diag = createDiagnostics('none');

class FakeMetricExporter {
  constructor(public readonly opts: unknown) {}
}
class FakePeriodicReader {
  constructor(public readonly opts: Record<string, unknown>) {}
}
class FakePrometheusExporter {
  constructor(public readonly opts: unknown) {}
}

const MODULES: Record<string, unknown> = {
  '@opentelemetry/exporter-metrics-otlp-http': { OTLPMetricExporter: FakeMetricExporter },
  '@opentelemetry/exporter-metrics-otlp-grpc': { OTLPMetricExporter: FakeMetricExporter },
  '@opentelemetry/exporter-prometheus': { PrometheusExporter: FakePrometheusExporter },
  '@opentelemetry/sdk-metrics': {
    PeriodicExportingMetricReader: FakePeriodicReader,
    ConsoleMetricExporter: FakeMetricExporter,
  },
};

const deps = (present: string[] = Object.keys(MODULES)): ExporterDeps => ({
  canResolve: (id: string) => present.includes(id),
  requireOptional: (id: string) => MODULES[id],
});

describe('resolveMetricReaders', () => {
  it('returns nothing for none', () => {
    expect(resolveMetricReaders('none', {}, diag, deps())).toEqual([]);
  });

  it('wraps a push exporter in a periodic reader', () => {
    const [reader] = resolveMetricReaders('otlp-http', { exportIntervalMs: 1234 }, diag, deps());
    expect(reader).toBeInstanceOf(FakePeriodicReader);
    expect((reader as FakePeriodicReader).opts['exportIntervalMillis']).toBe(1234);
    expect((reader as FakePeriodicReader).opts['exporter']).toBeInstanceOf(FakeMetricExporter);
  });

  it('passes the prometheus exporter through unwrapped', () => {
    const [reader] = resolveMetricReaders('prometheus', { port: 9999 }, diag, deps());
    expect(reader).toBeInstanceOf(FakePrometheusExporter);
    expect((reader as FakePrometheusExporter).opts).toMatchObject({ port: 9999 });
  });

  it('defaults the prometheus port', () => {
    const [reader] = resolveMetricReaders('prometheus', {}, diag, deps());
    expect((reader as FakePrometheusExporter).opts).toMatchObject({ port: 9464 });
  });

  it('throws when the prometheus package is missing', () => {
    expect(() => resolveMetricReaders('prometheus', {}, diag, deps([]))).toThrow(
      /@opentelemetry\/exporter-prometheus/,
    );
  });

  it('supports console metrics', () => {
    expect(resolveMetricReaders('console', {}, diag, deps())[0]).toBeInstanceOf(FakePeriodicReader);
  });

  it('fans out an array spec', () => {
    expect(resolveMetricReaders(['prometheus', 'otlp-http'], {}, diag, deps())).toHaveLength(2);
  });

  it('passes a supplied reader instance through', () => {
    const reader = { collect: async () => undefined };
    expect(resolveMetricReaders(reader, {}, diag, deps())[0]).toBe(reader);
  });

  it('calls a supplied factory', () => {
    const reader = { collect: async () => undefined };
    expect(resolveMetricReaders(() => reader, {}, diag, deps())[0]).toBe(reader);
  });

  it('throws on an unknown name', () => {
    expect(() => resolveMetricReaders('nope', {}, diag, deps())).toThrow(/nope/);
  });
});
