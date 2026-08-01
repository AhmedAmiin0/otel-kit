import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, Optional, type OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { ObservabilityConfig } from '../core/config/types';
import { logRequest } from '../core/logger/request-logger';
import type { ObsLogger } from '../core/logger/types';
import { OBSERVABILITY_CONFIG, OBSERVABILITY_LOGGER } from './tokens';

/** The slice of http.Server this needs. */
interface RequestServer {
  on(event: 'request', listener: (req: IncomingMessage, res: ServerResponse) => void): unknown;
}

/**
 * Logs completed requests from the HTTP server rather than from a middleware.
 *
 * Middleware registered through MiddlewareConsumer runs after the platform's
 * body parser. A payload the parser rejects therefore returns 400 without ever
 * reaching it, and the request never appears in the log at all — precisely the
 * request someone would go looking for. The server's own `request` event fires
 * before any middleware, so nothing is missed.
 *
 * Response bodies still arrive: ResponseBodyInterceptor stores them against the
 * same response object, and this logs on `finish`, after that has happened.
 */
@Injectable()
export class RequestLoggerHook implements OnApplicationBootstrap {
  constructor(
    @Inject(OBSERVABILITY_CONFIG)
    private readonly config: ObservabilityConfig,
    @Inject(OBSERVABILITY_LOGGER)
    private readonly logger: ObsLogger,
    @Optional()
    private readonly adapterHost?: HttpAdapterHost,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost?.httpAdapter?.getHttpServer() as RequestServer | undefined;

    // No HTTP server at all: a microservice or a standalone context.
    if (typeof server?.on !== 'function') return;

    const { config, logger } = this;

    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      // Echoed while headers are still mutable, matching the pino path.
      const header = config.logging.correlationIdHeader;
      const inbound = req.headers[header];
      const id = Array.isArray(inbound) ? inbound[0] : inbound;
      if (id) res.setHeader(header, id);

      res.on('finish', () => logRequest(logger, req, res, config));
    });
  }
}
