import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ObservabilityModule } from 'otel-kit/nestjs';
import { createWinstonLogger } from 'otel-kit/winston';
import winston from 'winston';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

/** Any logger works here; winston is used to show it needs no pino. */
const logger = createWinstonLogger(
  winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
  }),
);

@Module({
  imports: [
    // Importing HttpModule anywhere is enough: HttpClientLogger finds whichever
    // HttpService the application actually uses and patches that one.
    HttpModule,
    ObservabilityModule.forRoot({
      logger,
      config: {
        service: { name: 'otel-kit-demo', version: '0.1.0' },
        // Console keeps the demo runnable with no collector listening.
        traces: { exporter: 'console' },
        metrics: { exporter: 'none' },
        logs: { exporter: 'none' },
        // Shows which instrumentations were found and which were skipped.
        diagnostics: { level: 'debug' },
      },
    }),
  ],
  controllers: [PostsController],
  providers: [PostsService],
})
export class AppModule {}
