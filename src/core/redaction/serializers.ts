import type { IncomingMessage, ServerResponse } from 'node:http';
/**
 * Structural equivalents of pino's `Level` and pino-http's `ReqId`.
 *
 * Declared here so core carries no dependency on pino, not even a type-only
 * one. Any logger with the same level names satisfies this.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type RequestId = string | number | object;
import type { LoggingConfig, RedactionConfig } from '../config/types';
import { readCapturedBody } from './body-capture';
import { redactAndSerialize } from './redact';

interface RequestLike extends IncomingMessage {
  id: RequestId;
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
): LogLevel | 'silent' => {
  if (err || res.statusCode >= HTTP_SERVER_ERROR) return 'error';
  if (res.statusCode >= HTTP_CLIENT_ERROR) return 'warn';
  if (res.statusCode >= HTTP_REDIRECT) return 'silent';
  return 'info';
};

/** Only the two sections these read, so any caller holding a compatible pair can use them. */
export type SerializerConfig = { logging: LoggingConfig; redaction: RedactionConfig };

/**
 * Redacted view of an inbound request, independent of any logger.
 *
 * Works with a plain Node IncomingMessage, an Express request, or a Fastify
 * one — pass whatever your framework gives you.
 */
export const serializeRequest = (
  req: RequestLike,
  { logging, redaction }: SerializerConfig,
): Record<string, unknown> => ({
  id: req.id,
  method: req.method,
  url: req.originalUrl ?? req.url,
  remoteAddress: req.remoteAddress ?? req.socket?.remoteAddress,
  ...(logging.headers ? { headers: sanitizeHeaders(req.headers, redaction.placeholder) } : {}),
  ...(logging.requestBody
    ? { body: redactAndSerialize(req.raw?.body ?? req.body, redaction) }
    : {}),
});

/**
 * Redacted view of a response, independent of any logger.
 *
 * The body comes from whatever `storeCapturedBody` recorded for this response,
 * so it is available to any logger, not only pino.
 */
export const serializeResponse = (
  res: ServerResponse,
  { logging, redaction }: SerializerConfig,
): Record<string, unknown> => ({
  statusCode: res.statusCode,
  ...(logging.headers ? { headers: sanitizeHeaders(res.getHeaders(), redaction.placeholder) } : {}),
  ...(logging.responseBody ? { body: readCapturedBody(res) } : {}),
});

/** pino-shaped wrapper over the two serializers above. */
export const buildSerializers = (config: SerializerConfig) => ({
  req: (req: RequestLike) => serializeRequest(req, config),
  res: (res: SerializedResponse) => serializeResponse(res.raw, config),
});
