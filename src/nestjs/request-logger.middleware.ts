import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestLogConfig } from '../core/logger/request-logger';
import { logRequest } from '../core/logger/request-logger';
import type { ObsLogger } from '../core/logger/types';

/**
 * Logs completed requests through any ObsLogger.
 *
 * This is the logger-agnostic counterpart to the nestjs-pino path: it holds no
 * opinion about which logger it writes to, so winston, bunyan, log4js and pino
 * all reach the same record shape through the core adapters.
 *
 * Logging on `finish` rather than in the response pipeline means the record
 * carries the status actually sent and the body ResponseBodyInterceptor stored,
 * including on the error path.
 */
export const requestLoggerMiddleware =
  (logger: ObsLogger, config: RequestLogConfig) =>
  (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    // Echoed here, while headers are still mutable, to match what the pino
    // path does through genReqId.
    const header = config.logging.correlationIdHeader;
    const inbound = req.headers[header];
    const id = Array.isArray(inbound) ? inbound[0] : inbound;
    if (id) res.setHeader(header, id);

    res.on('finish', () => logRequest(logger, req, res, config));
    next();
  };
