import { Global, Module, type DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { loadObservabilityConfig, observabilityConfig } from './config';
import type { ObservabilityConfigInput } from './core/config/types';
import { HttpClientLogger } from './logging/http-client.logger';
import { buildPinoConfig } from './logging/pino.config';
import { RequestBodyInterceptor } from './logging/request-body.interceptor';
import { RequestExceptionFilter } from './logging/request-exception.filter';
import { TelemetryService } from './tracing/telemetry.service';

export interface ObservabilityModuleOptions {
  global?: boolean;
  /** Telemetry configuration, layered over environment variables and defaults. */
  config?: ObservabilityConfigInput;
}

@Global()
@Module({})
export class ObservabilityModule {
  static forRoot(options: ObservabilityModuleOptions = {}): DynamicModule {
    // `options` carries module wiring (global), not telemetry config. The
    // previous version spread it straight into the config object, where
    // `global` was a meaningless key.
    const config = loadObservabilityConfig(options.config ?? {});
    const httpClientLogging = config.logging.httpClient;

    return {
      module: ObservabilityModule,
      global: options.global ?? true,
      imports: [
        ConfigModule.forFeature(observabilityConfig),
        LoggerModule.forRootAsync({
          imports: [ConfigModule.forFeature(observabilityConfig)],
          inject: [observabilityConfig.KEY],
          useFactory: (config: ConfigType<typeof observabilityConfig>) => buildPinoConfig(config),
        }),
        ...(httpClientLogging ? [HttpModule] : []),
      ],
      providers: [
        TelemetryService,
        { provide: APP_INTERCEPTOR, useClass: RequestBodyInterceptor },
        { provide: APP_FILTER, useClass: RequestExceptionFilter },
        ...(httpClientLogging ? [HttpClientLogger] : []),
      ],
      exports: [TelemetryService, LoggerModule, ConfigModule, ...(httpClientLogging ? [HttpClientLogger] : [])],
    };
  }
}
