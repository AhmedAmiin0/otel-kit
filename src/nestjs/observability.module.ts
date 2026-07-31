import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { defineConfig } from '../core/config/define-config';
import type { ObservabilityConfig, ObservabilityConfigInput } from '../core/config/types';
import { OBSERVABILITY_CONFIG } from './tokens';
import { RequestBodyInterceptor } from './request-body.interceptor';
import { RequestExceptionFilter } from './request-exception.filter';
import { TelemetryService } from './telemetry.service';

/**
 * Controls the request logger.
 *
 * - omitted: register nestjs-pino with the built-in config, if it is installed
 * - `false`: register no logger module; bring your own however you like
 * - function: receive the built-in pino config and return the one to use
 * - module: register this module instead (winston, a custom logger, anything)
 */
export type LoggerOption =
  | false
  | ((defaults: PinoParams) => PinoParams)
  | DynamicModule;

/** Structural stand-in for nestjs-pino's Params, so this file needs no pino types. */
export type PinoParams = Record<string, unknown>;

export interface ObservabilityModuleOptions {
  global?: boolean;
  /** Telemetry configuration, layered over environment variables and defaults. */
  config?: ObservabilityConfigInput;
  logger?: LoggerOption;
  /**
   * Register the global interceptor that captures response bodies for logging.
   * Defaults to `logging.responseBody`, so turning that off — via config or
   * LOG_RESPONSE_BODY=false — also stops the interceptor being installed
   * rather than leaving it registered and inert on every request.
   */
  responseBodyInterceptor?: boolean;
  /**
   * Register the global exception filter. On by default: besides capturing
   * error bodies it backfills the span route for requests that matched no
   * handler, which is what keeps those traces from being named generically.
   * Set false if you register your own global filter and it conflicts.
   */
  exceptionFilter?: boolean;
}

export interface ObservabilityModuleAsyncOptions {
  global?: boolean;
  imports?: DynamicModule['imports'];
  inject?: unknown[];
  useFactory: (...args: never[]) => ObservabilityConfigInput | Promise<ObservabilityConfigInput>;
  /** Defaults to true — the config is not known until the factory runs. */
  responseBodyInterceptor?: boolean;
  exceptionFilter?: boolean;
}

const canResolve = (id: string): boolean => {
  try {
    require.resolve(id);
    return true;
  } catch {
    return false;
  }
};

const isDynamicModule = (value: unknown): value is DynamicModule =>
  typeof value === 'object' && value !== null && 'module' in value;

/**
 * Resolves the request logger.
 *
 * The built-in pino wiring is a default, not a mandate: pass `logger: false`
 * to opt out entirely, a function to adjust the generated config, or your own
 * module to replace it. pino stays out of the required dependency tree, so a
 * consumer without it gets tracing and metrics and no request logging.
 */
const loggerImports = (
  config: ObservabilityConfig,
  logger: LoggerOption | undefined,
): NonNullable<DynamicModule['imports']> => {
  if (logger === false) return [];
  if (isDynamicModule(logger)) return [logger];
  if (!canResolve('nestjs-pino')) return [];

  const { LoggerModule } = require('nestjs-pino') as typeof import('nestjs-pino');
  const { buildPinoConfig } = require('../pino/pino.config') as typeof import('../pino/pino.config');

  const defaults = buildPinoConfig(config) as PinoParams;
  const params = typeof logger === 'function' ? logger(defaults) : defaults;

  return [LoggerModule.forRoot(params as Parameters<typeof LoggerModule.forRoot>[0])];
};

const httpClientEnabled = (config: ObservabilityConfig): boolean =>
  config.logging.httpClient && canResolve('@nestjs/axios');

const httpClientImports = (
  config: ObservabilityConfig,
): NonNullable<DynamicModule['imports']> => {
  if (!httpClientEnabled(config)) return [];
  const { HttpModule } = require('@nestjs/axios') as typeof import('@nestjs/axios');
  return [HttpModule];
};

/**
 * The two global request-path providers, each independently opt-out.
 *
 * `interceptor` is undefined when the caller did not say, in which case the
 * decision falls to the resolved config.
 */
const requestProviders = (opts: {
  interceptor: boolean;
  filter: boolean;
}): Provider[] => [
  ...(opts.interceptor ? [{ provide: APP_INTERCEPTOR, useClass: RequestBodyInterceptor }] : []),
  ...(opts.filter ? [{ provide: APP_FILTER, useClass: RequestExceptionFilter }] : []),
];

const httpClientProviders = (config: ObservabilityConfig): Provider[] => {
  if (!httpClientEnabled(config)) return [];
  const { HttpClientLogger } =
    require('./http-client.logger') as typeof import('./http-client.logger');
  return [HttpClientLogger];
};

@Global()
@Module({})
export class ObservabilityModule {
  static forRoot(options: ObservabilityModuleOptions = {}): DynamicModule {
    // `options` carries module wiring, not telemetry config. The original
    // spread it straight into the config object, where `global` meant nothing.
    const config = defineConfig(options.config ?? {});
    const clientProviders = httpClientProviders(config);

    return {
      module: ObservabilityModule,
      global: options.global ?? true,
      imports: [...loggerImports(config, options.logger), ...httpClientImports(config)],
      providers: [
        { provide: OBSERVABILITY_CONFIG, useValue: config },
        TelemetryService,
        ...requestProviders({
          interceptor: options.responseBodyInterceptor ?? config.logging.responseBody,
          filter: options.exceptionFilter ?? true,
        }),
        ...clientProviders,
      ],
      exports: [OBSERVABILITY_CONFIG, TelemetryService, ...clientProviders],
    };
  }

  /** For consumers who build the config from ConfigService or another async source. */
  static forRootAsync(options: ObservabilityModuleAsyncOptions): DynamicModule {
    return {
      module: ObservabilityModule,
      global: options.global ?? true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: OBSERVABILITY_CONFIG,
          inject: (options.inject ?? []) as never[],
          useFactory: async (...args: never[]) => defineConfig(await options.useFactory(...args)),
        },
        TelemetryService,
        ...requestProviders({
          interceptor: options.responseBodyInterceptor ?? true,
          filter: options.exceptionFilter ?? true,
        }),
      ],
      exports: [OBSERVABILITY_CONFIG, TelemetryService],
    };
  }
}
