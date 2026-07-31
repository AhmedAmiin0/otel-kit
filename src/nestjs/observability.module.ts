import {
  Global,
  Module,
  type DynamicModule,
  type NestInterceptor,
  type Provider,
  type Type,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { defineConfig } from '../core/config/define-config';
import { createDiagnostics } from '../core/diagnostics';
import type { ObservabilityConfig, ObservabilityConfigInput } from '../core/config/types';
import { OBSERVABILITY_CONFIG } from './tokens';
import { ResponseBodyInterceptor } from './response-body.interceptor';
import { TelemetryService } from './telemetry.service';

/** Structural stand-in for nestjs-pino's Params, so this file needs no pino types. */
export type PinoParams = Record<string, unknown>;

/** `false` for none, a function to adjust the built-in config, or a module to use instead. */
export type LoggerOption = false | ((defaults: PinoParams) => PinoParams) | DynamicModule;

/**
 * How the request-path interceptor is registered.
 *
 * - omitted / `true`: the built-in ResponseBodyInterceptor
 * - `false`: none
 * - a class: registered under APP_INTERCEPTOR in place of the built-in
 * - a provider: used verbatim, so useFactory and useExisting work too
 */
export type InterceptorOption = boolean | Type<NestInterceptor> | Provider;

interface ProviderOptions {
  /**
   * The built-in interceptor captures response bodies and backfills the span
   * route on errors. Body capture itself still follows `logging.responseBody`.
   */
  interceptor?: InterceptorOption;
}

export interface ObservabilityModuleOptions extends ProviderOptions {
  global?: boolean;
  config?: ObservabilityConfigInput;
  logger?: LoggerOption;
}

export interface ObservabilityModuleAsyncOptions extends ProviderOptions {
  global?: boolean;
  imports?: DynamicModule['imports'];
  inject?: unknown[];
  useFactory: (...args: never[]) => ObservabilityConfigInput | Promise<ObservabilityConfigInput>;
}

/** Loads an optional peer, or undefined when it is absent. */
const loadOptional = <T>(id: string): T | undefined => {
  try {
    return require(id) as T;
  } catch {
    return undefined;
  }
};

const isDynamicModule = (value: unknown): value is DynamicModule =>
  typeof value === 'object' && value !== null && 'module' in value;

/** pino is loaded here, not imported, so it stays out of the required dependency tree. */
const loggerImports = (
  config: ObservabilityConfig,
  logger: LoggerOption | undefined,
): NonNullable<DynamicModule['imports']> => {
  if (logger === false) return [];
  if (isDynamicModule(logger)) return [logger];

  const pino = loadOptional<typeof import('nestjs-pino')>('nestjs-pino');

  if (!pino) {
    // Never silently produce no logging. A caller who passed a customizer
    // clearly wants pino, so that is a warning; otherwise it is a default that
    // simply does not apply here.
    createDiagnostics(config.diagnostics.level).log(
      logger === undefined ? 'debug' : 'warn',
      'request logging is off: install nestjs-pino to enable it, ' +
        'or pass `logger: false` to silence this',
    );
    return [];
  }

  const { buildPinoConfig } = require('../pino/pino.config') as typeof import('../pino/pino.config');

  const defaults = buildPinoConfig(config) as PinoParams;
  const params = typeof logger === 'function' ? logger(defaults) : defaults;

  return [pino.LoggerModule.forRoot(params as Parameters<typeof pino.LoggerModule.forRoot>[0])];
};

/**
 * HTTP client logging is not wired automatically.
 *
 * HttpClientLogger patches the axios instance behind whichever HttpService is
 * injected into it. Importing HttpModule here would bind the one from the
 * static module, which is a different instance from the one produced by
 * `HttpModule.register(...)` — so a consumer who configures a timeout or
 * baseURL would get no outbound logging and no indication why. Registering it
 * next to their own HttpModule is the only way to reach the right instance.
 */
const noteHttpClientSetup = (config: ObservabilityConfig): void => {
  if (!config.logging.httpClient) return;

  createDiagnostics(config.diagnostics.level).debug(
    'HTTP client logging needs wiring: add HttpClientLogger to the providers of ' +
      'the module that imports HttpModule, or set LOG_HTTP_CLIENT=false to silence this',
  );
};

const interceptorProvider = (interceptor: InterceptorOption | undefined): Provider[] => {
  if (interceptor === false) return [];
  if (interceptor === undefined || interceptor === true) {
    return [{ provide: APP_INTERCEPTOR, useClass: ResponseBodyInterceptor }];
  }

  // A bare class means "use this as the interceptor"; anything else is already
  // a provider and is registered as given.
  return typeof interceptor === 'function'
    ? [{ provide: APP_INTERCEPTOR, useClass: interceptor as Type<NestInterceptor> }]
    : [interceptor];
};

/** Every provider the module contributes, in one place. */
const registerProviders = (
  configProvider: Provider,
  options: ProviderOptions,
): Pick<DynamicModule, 'providers' | 'exports'> => ({
  providers: [configProvider, TelemetryService, ...interceptorProvider(options.interceptor)],
  exports: [OBSERVABILITY_CONFIG, TelemetryService],
});

@Global()
@Module({})
export class ObservabilityModule {
  static forRoot(options: ObservabilityModuleOptions = {}): DynamicModule {
    const config = defineConfig(options.config ?? {});
    noteHttpClientSetup(config);

    const { providers, exports } = registerProviders(
      { provide: OBSERVABILITY_CONFIG, useValue: config },
      options,
    );

    return {
      module: ObservabilityModule,
      global: options.global ?? true,
      imports: loggerImports(config, options.logger),
      providers,
      exports,
    };
  }

  /** For consumers who build the config from ConfigService or another async source. */
  static forRootAsync(options: ObservabilityModuleAsyncOptions): DynamicModule {
    const { providers, exports } = registerProviders(
      {
        provide: OBSERVABILITY_CONFIG,
        inject: (options.inject ?? []) as never[],
        useFactory: async (...args: never[]) => defineConfig(await options.useFactory(...args)),
      },
      options,
    );

    return {
      module: ObservabilityModule,
      global: options.global ?? true,
      imports: options.imports ?? [],
      providers,
      exports,
    };
  }
}
