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

/** pino is loaded here, not imported, so it stays out of the required dependency tree. */
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

const requestProviders = ({ interceptor }: ProviderOptions): Provider[] => {
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
    const config = defineConfig(options.config ?? {});
    const clientProviders = httpClientProviders(config);

    return {
      module: ObservabilityModule,
      global: options.global ?? true,
      imports: [...loggerImports(config, options.logger), ...httpClientImports(config)],
      providers: [
        { provide: OBSERVABILITY_CONFIG, useValue: config },
        TelemetryService,
        ...requestProviders(options),
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
        ...requestProviders(options),
      ],
      exports: [OBSERVABILITY_CONFIG, TelemetryService],
    };
  }
}
