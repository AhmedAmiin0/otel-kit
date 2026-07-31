import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LoggingConfig, RedactionConfig } from '../config/types';
import {
  httpLogLevel,
  serializeRequest,
  serializeResponse,
  type SerializerConfig,
} from '../redaction/serializers';
import type { ObsLogger } from './types';

export interface RequestLogConfig extends SerializerConfig {
  logging: LoggingConfig;
  redaction: RedactionConfig;
}

/**
 * The log record for one completed request, ready to hand to any logger.
 *
 * Returns undefined when the route is excluded or the status maps to silent,
 * so callers can skip without repeating that logic.
 */
export const buildRequestLog = (
  req: IncomingMessage,
  res: ServerResponse,
  config: RequestLogConfig,
  err?: Error,
): { level: Exclude<ReturnType<typeof httpLogLevel>, 'silent'>; record: object } | undefined => {
  const url = (req as { originalUrl?: string }).originalUrl ?? req.url ?? '';
  if (config.logging.excludeRoutes.some((route) => url.startsWith(route))) return undefined;

  const level = httpLogLevel(req, res, err);
  if (level === 'silent') return undefined;

  const correlationId = req.headers[config.logging.correlationIdHeader];

  return {
    level,
    record: {
      context: 'HTTP',
      ...(correlationId ? { correlation_id: correlationId } : {}),
      req: serializeRequest(req as never, config),
      res: serializeResponse(res, config),
      ...(err ? { err: { message: err.message, stack: err.stack } } : {}),
    },
  };
};

/**
 * Framework-agnostic request logging for any ObsLogger.
 *
 * Attach from Express, Fastify, or plain Node; pino is one option rather than
 * a requirement.
 */
export const logRequest = (
  logger: ObsLogger,
  req: IncomingMessage,
  res: ServerResponse,
  config: RequestLogConfig,
  err?: Error,
): void => {
  const entry = buildRequestLog(req, res, config, err);
  if (!entry) return;

  const { level, record } = entry;
  const write = level === 'trace' || level === 'fatal' ? logger.info : logger[level];
  write.call(logger, record, `${req.method} ${req.url} ${res.statusCode}`);
};
