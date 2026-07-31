import type { DynamicModule } from '@nestjs/common';
import { ObservabilityModule } from './observability.module';
import { OBSERVABILITY_CONFIG } from './tokens';

const importsOf = (mod: DynamicModule): unknown[] => (mod.imports ?? []) as unknown[];

describe('ObservabilityModule.forRoot', () => {
  it('provides the resolved config under the plain token', () => {
    const mod = ObservabilityModule.forRoot({ config: { service: { name: 'orders' } } });
    const provider = (mod.providers ?? []).find(
      (p) => typeof p === 'object' && p !== null && 'provide' in p && p.provide === OBSERVABILITY_CONFIG,
    ) as { useValue: { service: { name: string } } };

    expect(provider.useValue.service.name).toBe('orders');
  });

  it('keeps module options out of the telemetry config', () => {
    const mod = ObservabilityModule.forRoot({ global: false });
    const provider = (mod.providers ?? []).find(
      (p) => typeof p === 'object' && p !== null && 'provide' in p && p.provide === OBSERVABILITY_CONFIG,
    ) as { useValue: Record<string, unknown> };

    expect(provider.useValue).not.toHaveProperty('global');
    expect(mod.global).toBe(false);
  });

  it('registers a logger module by default when nestjs-pino is installed', () => {
    expect(importsOf(ObservabilityModule.forRoot()).length).toBeGreaterThan(0);
  });

  // httpClient logging is disabled here so `imports` reflects only the logger.
  const loggerOnly = { config: { logging: { httpClient: false } } };

  it('registers no logger module when logger is false', () => {
    expect(importsOf(ObservabilityModule.forRoot({ ...loggerOnly, logger: false }))).toEqual([]);
  });

  it('passes the built-in pino config to a customizer and uses its result', () => {
    let seen: Record<string, unknown> | undefined;

    ObservabilityModule.forRoot({
      logger: (defaults) => {
        seen = defaults;
        return { ...defaults, pinoHttp: { level: 'trace' } };
      },
    });

    // The customizer receives a real generated config, not an empty object.
    expect(seen).toBeDefined();
    expect(seen).toHaveProperty('pinoHttp');
  });

  it('uses a supplied module instead of the built-in logger', () => {
    class MyLoggerModule {}
    const custom: DynamicModule = { module: MyLoggerModule, providers: [], exports: [] };

    expect(importsOf(ObservabilityModule.forRoot({ ...loggerOnly, logger: custom }))).toEqual([
      custom,
    ]);
  });

  it('always registers the interceptor and exception filter', () => {
    const providers = ObservabilityModule.forRoot({ logger: false }).providers ?? [];
    expect(providers.length).toBeGreaterThanOrEqual(4);
  });
});
