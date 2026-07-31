import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { defineConfig } from '../core/config/define-config';
import type { ObservabilityConfig, ObservabilityConfigInput } from '../core/config/types';
import { OBSERVABILITY_CONFIG } from './tokens';
import { RequestBodyInterceptor } from './request-body.interceptor';
import { RequestExceptionFilter } from './request-exception.filter';
import { TelemetryService } from './telemetry.service';

export interface ObservabilityModuleOptions {
  global?: boolean;
  /** Telemetry configuration, layered over environment variables and defaults. */
  config?: ObservabilityConfigInput;
}

export interface ObservabilityModuleAsyncOptions {
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

/**
 * Loads the pino logger module only when nestjs-pino is actually installed.
 *
 * Keeps pino out of the required dependency tree: a consumer without it gets
 * tracing and metrics, and simply no request logging.
 */
const pinoImports = (config: ObservabilityConfig): NonNullable<DynamicModule['imports']> => {
  if (!canResolve('nestjs-pino')) return [];

  const { LoggerModule } = require('nestjs-pino') as typeof import('nestjs-pino');
  const { buildPinoConfig } = require('../pino/pino.config') as typeof import('../pino/pino.config');
  return [LoggerModule.forRoot(buildPinoConfig(config))];
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
      imports: [...pinoImports(config), ...httpClientImports(config)],
      providers: [
        { provide: OBSERVABILITY_CONFIG, useValue: config },
        TelemetryService,
        { provide: APP_INTERCEPTOR, useClass: RequestBodyInterceptor },
        { provide: APP_FILTER, useClass: RequestExceptionFilter },
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
        { provide: APP_INTERCEPTOR, useClass: RequestBodyInterceptor },
        { provide: APP_FILTER, useClass: RequestExceptionFilter },
      ],
      exports: [OBSERVABILITY_CONFIG, TelemetryService],
    };
  }
}
