import {
  Global,
  Inject,
  Module,
  Optional,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestInterceptor,
  type NestModule,
  type Provider,
  type Type,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { defineConfig } from '../core/config/define-config';
import { createDiagnostics } from '../core/diagnostics';
import type { ObservabilityConfig, ObservabilityConfigInput } from '../core/config/types';
import type { ObsLogger } from '../core/logger/types';
import { OBSERVABILITY_CONFIG, OBSERVABILITY_LOGGER } from './tokens';
import { requestLoggerMiddleware } from './request-logger.middleware';
import { ResponseBodyInterceptor } from './response-body.interceptor';
import { TelemetryService } from './telemetry.service';

/** Structural stand-in for nestjs-pino's Params, so this file needs no pino types. */
export type PinoParams = Record<string, unknown>;

/**
 * How requests get logged.
 *
 * - omitted: nestjs-pino when it is installed, nothing otherwise
 * - `false`: no request logging
 * - an ObsLogger: winston, bunyan, log4js or anything else, adapted through
 *   `fromMessageFirst` / `fromObjectFirst` and driven by a middleware here
 * - a function: adjusts the built-in pino config
 * - a module: registered instead, for logging wired up entirely by the caller
 */
export type LoggerOption =
  | false
  | ObsLogger
  | ((defaults: PinoParams) => PinoParams)
  | DynamicModule;

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
  logger?: LoggerOption;
}

export interface ObservabilityModuleOptions extends ProviderOptions {
  global?: boolean;
  config?: ObservabilityConfigInput;
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

/** A logger instance, as opposed to a module or a config customizer. */
const isObsLogger = (value: unknown): value is ObsLogger =>
  typeof value === 'object' && value !== null && typeof (value as ObsLogger).info === 'function';

/** pino is loaded here, not imported, so it stays out of the required dependency tree. */
const loggerImports = (
  config: ObservabilityConfig,
  logger: LoggerOption | undefined,
): NonNullable<DynamicModule['imports']> => {
  // A supplied logger needs no module: the middleware below writes to it.
  if (logger === false || isObsLogger(logger)) return [];
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
 * Registers outbound HTTP logging whenever @nestjs/axios is present.
 *
 * The logger resolves HttpService from the container at init rather than
 * having it injected, so it reaches whichever instance the application
 * actually uses — importing HttpModule here would bind the static one, which
 * differs from what `HttpModule.register(...)` provides.
 */
const httpClientProvider = (config: ObservabilityConfig): Provider[] => {
  if (!config.logging.httpClient) return [];
  if (!loadOptional('@nestjs/axios')) return [];

  const { HttpClientLogger } =
    require('./http-client.logger') as typeof import('./http-client.logger');
  return [HttpClientLogger];
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

/** Publishes a supplied logger so the middleware and consumers can reach it. */
const loggerProvider = (logger: LoggerOption | undefined): Provider[] =>
  isObsLogger(logger) ? [{ provide: OBSERVABILITY_LOGGER, useValue: logger }] : [];

/** Every provider the module contributes, in one place. */
const registerProviders = (
  configProvider: Provider,
  config: ObservabilityConfig,
  options: ProviderOptions,
): Pick<DynamicModule, 'providers' | 'exports'> => {
  const httpClient = httpClientProvider(config);
  const logger = loggerProvider(options.logger);

  return {
    providers: [
      configProvider,
      TelemetryService,
      ...logger,
      ...interceptorProvider(options.interceptor),
      ...httpClient,
    ],
    // Tokens, not the provider objects, so consumers can inject them.
    exports: [
      OBSERVABILITY_CONFIG,
      TelemetryService,
      ...logger.map(() => OBSERVABILITY_LOGGER),
      ...httpClient,
    ],
  };
};

@Global()
@Module({})
export class ObservabilityModule implements NestModule {
  constructor(
    @Inject(OBSERVABILITY_CONFIG) private readonly config: ObservabilityConfig,
    @Optional() @Inject(OBSERVABILITY_LOGGER) private readonly logger?: ObsLogger,
  ) {}

  /**
   * Applied only when a logger instance was supplied. The nestjs-pino path
   * brings its own middleware, and `logger: false` gets none at all.
   *
   * Config is injected rather than captured in forRoot so that forRootAsync,
   * whose config is not known until its factory runs, logs the real thing.
   */
  configure(consumer: MiddlewareConsumer): void {
    if (!this.logger) return;

    consumer
      .apply(requestLoggerMiddleware(this.logger, this.config))
      .forRoutes({ path: '{/*splat}', method: RequestMethod.ALL });
  }

  static forRoot(options: ObservabilityModuleOptions = {}): DynamicModule {
    const config = defineConfig(options.config ?? {});
    const { providers, exports } = registerProviders(
      { provide: OBSERVABILITY_CONFIG, useValue: config },
      config,
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
      // The real config is not known until the factory runs; the logger checks
      // logging.httpClient again at init, so registering it here is safe.
      defineConfig({}),
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
