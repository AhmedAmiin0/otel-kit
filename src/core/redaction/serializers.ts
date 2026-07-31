import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Level } from 'pino';
import type { ReqId } from 'pino-http';
import type { LoggingConfig, RedactionConfig } from '../config/types';
import { readCapturedBody } from './body-capture';
import { redactAndSerialize } from './redact';

interface RequestLike extends IncomingMessage {
  id: ReqId;
  body?: unknown;
  originalUrl?: string;
  raw?: { body?: unknown };
  remoteAddress?: string;
}

interface SerializedResponse {
  statusCode: number | null;
  headers: NodeJS.Dict<string | string[] | number>;
  raw: ServerResponse;
  body?: unknown;
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'access-token',
  'apigeeauthtoken'
]);

const HTTP_REDIRECT = 300;
const HTTP_CLIENT_ERROR = 400;
const HTTP_SERVER_ERROR = 500;

export const sanitizeHeaders = (
  headers: NodeJS.Dict<string | string[] | number>,
  placeholder: string,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? placeholder : value;
  }
  return out;
};

export const httpLogLevel = (
  _req: IncomingMessage,
  res: ServerResponse,
  err?: Error,
): Level | 'silent' => {
  if (err || res.statusCode >= HTTP_SERVER_ERROR) return 'error';
  if (res.statusCode >= HTTP_CLIENT_ERROR) return 'warn';
  if (res.statusCode >= HTTP_REDIRECT) return 'silent';
  return 'info';
};

/**
 * Takes only the two sections it reads rather than the whole config, so it
 * stays usable from any caller holding a compatible logging/redaction pair.
 */
export const buildSerializers = (config: {
  logging: LoggingConfig;
  redaction: RedactionConfig;
}) => {
  const { logging, redaction } = config;

  return {
    req: (req: RequestLike) => ({
      id: req.id,
      method: req.method,
      url: req.originalUrl ?? req.url,
      remoteAddress: req.remoteAddress ?? req.socket?.remoteAddress,
      ...(logging.headers
        ? { headers: sanitizeHeaders(req.headers, redaction.placeholder) }
        : {}),
      ...(logging.requestBody
        ? { body: redactAndSerialize(req.raw?.body ?? req.body, redaction) }
        : {}),
    }),
    res: (res: SerializedResponse) => ({
      statusCode: res.statusCode,
      ...(logging.headers
        ? { headers: sanitizeHeaders(res.headers, redaction.placeholder) }
        : {}),
      ...(logging.responseBody ? { body: readCapturedBody(res.raw) } : {}),
    }),
  };
};
