import type {
  CallHandler,
  DynamicModule,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { ObservabilityModule } from './observability.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
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

});

describe('request-path providers', () => {
  const providersOf = (mod: DynamicModule): unknown[] =>
    (mod.providers ?? []).filter(
      (p) => (p as { provide?: unknown }).provide === APP_INTERCEPTOR,
    );

  const classesOf = (mod: DynamicModule): string[] =>
    (mod.providers ?? []).flatMap((p) => {
      const useClass = (p as { useClass?: { name: string } }).useClass;
      return useClass ? [useClass.name] : [];
    });

  it('registers the interceptor by default', () => {
    expect(classesOf(ObservabilityModule.forRoot())).toEqual(['ResponseBodyInterceptor']);
  });

  // The interceptor also backfills the span route, worth doing whether or not
  // bodies are logged; the flag gates capture inside it, not registration.
  it('keeps the interceptor when response body logging is off', () => {
    const mod = ObservabilityModule.forRoot({ config: { logging: { responseBody: false } } });
    expect(classesOf(mod)).toContain('ResponseBodyInterceptor');
  });

  it('skips the interceptor when asked', () => {
    expect(classesOf(ObservabilityModule.forRoot({ interceptor: false }))).toEqual([]);
  });

  it('registers the built-in when interceptor is true', () => {
    expect(classesOf(ObservabilityModule.forRoot({ interceptor: true }))).toEqual([
      'ResponseBodyInterceptor',
    ]);
  });

  it('accepts a replacement interceptor class without a cast', () => {
    class MyInterceptor implements NestInterceptor {
      intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
        return next.handle();
      }
    }
    const mod = ObservabilityModule.forRoot({ interceptor: MyInterceptor });

    expect(classesOf(mod)).toEqual(['MyInterceptor']);
    expect(providersOf(mod)[0]).toMatchObject({ provide: APP_INTERCEPTOR });
  });

  it('accepts a full provider and registers it verbatim', () => {
    const provider = {
      provide: APP_INTERCEPTOR,
      useFactory: () => ({ intercept: (_c: unknown, next: { handle: () => unknown }) => next.handle() }),
    };
    const mod = ObservabilityModule.forRoot({ interceptor: provider });

    expect(providersOf(mod)).toContain(provider);
    expect(classesOf(mod)).toEqual([]);
  });

  it('lets a useExisting provider reuse an already-registered interceptor', () => {
    const provider = { provide: APP_INTERCEPTOR, useExisting: 'MY_TOKEN' };
    expect(providersOf(ObservabilityModule.forRoot({ interceptor: provider }))).toContain(provider);
  });

  it('applies the same defaults to forRootAsync', () => {
    const mod = ObservabilityModule.forRootAsync({ useFactory: () => ({}) });
    expect(classesOf(mod)).toEqual(['ResponseBodyInterceptor']);
  });

  it('honours the options on forRootAsync', () => {
    const mod = ObservabilityModule.forRootAsync({ useFactory: () => ({}), interceptor: false });
    expect(classesOf(mod)).toEqual([]);
  });
});
