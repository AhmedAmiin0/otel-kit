import { Global, Module, type DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { loadObservabilityConfig, observabilityConfig } from './config';
import { HttpClientLogger } from './logging/http-client.logger';
import { buildPinoConfig } from './logging/pino.config';
import { RequestBodyInterceptor } from './logging/request-body.interceptor';
import { RequestExceptionFilter } from './logging/request-exception.filter';
import { TelemetryService } from './tracing/telemetry.service';

export interface ObservabilityModuleOptions {
  global?: boolean;
}

@Global()
@Module({})
export class ObservabilityModule {
  static forRoot(options: ObservabilityModuleOptions = {}): DynamicModule {
    const config = loadObservabilityConfig(options);
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
