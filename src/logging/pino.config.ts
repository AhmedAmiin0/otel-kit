import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import type { Params } from 'nestjs-pino';
import type pino from 'pino';
import type { ObservabilityConfig } from '../config';
import { buildSerializers, httpLogLevel } from './serializers';

export const buildPinoConfig = (config: ObservabilityConfig): Params => {
  const { logging, redaction } = config;
  const correlationHeader = logging.correlationIdHeader;

  let transport: pino.TransportSingleOptions | undefined;
  if (logging.pretty) {
    try {
      require.resolve('pino-pretty');
      transport = {
        target: 'pino-pretty',
        options: { colorize: true, singleLine: false },
      };
    } catch {
      transport = undefined;
    }
  }

  return {
    pinoHttp: {
      level: logging.level,
      autoLogging: {
        ignore: (req: IncomingMessage) => {
          const url = req.url ?? '';
          return logging.excludeRoutes.some((route) => url.startsWith(route));
        },
      },
      safe: true,
      quietReqLogger: logging.quietRequestLogger,
      ...(transport ? { transport } : {}),
      customLogLevel: httpLogLevel,
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const inbound = req.headers[correlationHeader];
        const id = Array.isArray(inbound) ? inbound[0] : inbound;

        if (!id) return undefined as unknown as string;

        res.setHeader(correlationHeader, id);
        return id;
      },
      customProps: (req: IncomingMessage) => ({
        context: 'HTTP',
        correlation_id: req.headers[correlationHeader],
      }),
      serializers: buildSerializers(config),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'res.headers["set-cookie"]',
          'headers.authorization',
          'headers.cookie',
        ],
        censor: redaction.placeholder,
      },
    },
    forRoutes: [{ path: '{/*splat}', method: RequestMethod.ALL }],
  };
};
