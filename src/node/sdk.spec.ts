import { createSdk } from './sdk';
import { defineConfig } from '../core/config/define-config';
import type { ObservabilityConfigInput } from '../core/config/types';

/** Console traces, no metrics, no logs — needs no collector and no extra packages. */
const quiet = (extra: ObservabilityConfigInput = {}): ObservabilityConfigInput => ({
  traces: { exporter: 'console' },
  metrics: { exporter: 'none' },
  logs: { exporter: 'none' },
  ...extra,
});

describe('createSdk', () => {
  it('builds a console-only pipeline with no collector configured', () => {
    const built = createSdk(defineConfig(quiet(), {}));
    expect(built.traceExporters).toHaveLength(1);
    expect(built.metricReaders).toHaveLength(0);
    expect(built.logExporters).toHaveLength(0);
  });

  it('resolves no instrumentations when nothing is installed', () => {
    const built = createSdk(defineConfig(quiet(), {}), {
      canResolve: (id: string) => id === '@opentelemetry/sdk-trace-base',
      requireOptional: (id: string) => require(id),
    });
    expect(built.instrumentations).toHaveLength(0);
  });

  it('includes a user-supplied instrumentation instance', () => {
    const instance = {
      instrumentationName: 'custom',
      instrumentationVersion: '1',
      enable() {},
      disable() {},
    };
    const built = createSdk(defineConfig(quiet({ instrumentations: { custom: instance } }), {}));
    expect(built.instrumentations).toContain(instance);
  });

  it('stamps the service name onto the resource', () => {
    const built = createSdk(
      defineConfig(quiet({ service: { name: 'orders-api', version: '2.1.0' } }), {}),
    );
    expect(built.resourceAttributes).toMatchObject({
      'service.name': 'orders-api',
      'service.version': '2.1.0',
    });
  });

  it('merges custom resource attributes', () => {
    const built = createSdk(
      defineConfig(quiet({ resource: { attributes: { 'deployment.environment': 'staging' } } }), {}),
    );
    expect(built.resourceAttributes).toMatchObject({ 'deployment.environment': 'staging' });
  });

  it('propagates an exporter error rather than starting half-configured', () => {
    expect(() => createSdk(defineConfig({ traces: { exporter: 'carrier-pigeon' } }, {}))).toThrow(
      /carrier-pigeon/,
    );
  });

  it('produces an sdk that can be started and shut down', async () => {
    const built = createSdk(defineConfig(quiet(), {}));
    expect(typeof built.sdk.start).toBe('function');
    await expect(built.sdk.shutdown()).resolves.toBeUndefined();
  });
});
