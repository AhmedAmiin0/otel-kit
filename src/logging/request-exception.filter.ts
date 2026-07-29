import type { ServerResponse } from 'node:http';
import { Catch, Inject, HttpException, type ArgumentsHost } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { context } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { observabilityConfig } from '../config';
import { storeCapturedBody } from './body-capture';
import { redactAndSerialize } from './redact';

@Catch()
export class RequestExceptionFilter extends BaseExceptionFilter {
  constructor(
    httpAdapterHost: HttpAdapterHost,
    @Inject(observabilityConfig.KEY)
    private readonly config: ConfigType<typeof observabilityConfig>,
  ) {
    super(httpAdapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      const request = host.switchToHttp().getRequest();
      const rpc = getRPCMetadata(context.active());
      if (rpc?.type === RPCType.HTTP && rpc.route === undefined) {
        const path = (request.originalUrl ?? request.url ?? '').split('?')[0];
        if (path) {
          rpc.route = path;
        }
      }
    }

    if (this.config.logging.responseBody && host.getType() === 'http') {
      const res = host.switchToHttp().getResponse<ServerResponse>();
      const serialized = redactAndSerialize(errorResponseBody(exception), this.config.redaction);
      if (serialized !== undefined) {
        storeCapturedBody(res, serialized);
      }
    }

    super.catch(exception, host);
  }
}

export const errorResponseBody = (exception: unknown): unknown =>
  exception instanceof HttpException ? exception.getResponse() : { statusCode: 500, message: 'Internal server error' };
