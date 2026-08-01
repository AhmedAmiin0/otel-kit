import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ObservabilityModule } from 'otel-kit/nestjs';
import { createWinstonLogger } from 'otel-kit/winston';
import winston from 'winston';
import { observability } from './observability.config';
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
    // The same object the preload started the SDK with.
    ObservabilityModule.forRoot({ logger, config: observability }),
  ],
  controllers: [PostsController],
  providers: [PostsService],
})
export class AppModule {}
