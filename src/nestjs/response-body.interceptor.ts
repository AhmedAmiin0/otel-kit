import type { ServerResponse } from 'node:http';
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { context as otelContext } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import { throwError, type Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import type { ObservabilityConfig } from '../core/config/types';
import { OBSERVABILITY_CONFIG } from './tokens';
import { storeCapturedBody } from '../core/redaction/body-capture';
import { redactAndSerialize } from '../core/redaction/redact';
import { errorResponseBody } from './error-body';

/**
 * Captures response bodies and, on the error path, backfills the span route.
 *
 * Both jobs live in an interceptor rather than an exception filter on purpose.
 * APP_FILTER is not cumulative — a global filter registered here takes over
 * exception handling for the whole application and silently stops the
 * consumer's own filter from running. APP_INTERCEPTOR composes: every
 * registered interceptor runs, so observing the error here and rethrowing it
 * leaves the consumer's error handling exactly as it was.
 */
@Injectable()
export class ResponseBodyInterceptor implements NestInterceptor {
  constructor(
    @Inject(OBSERVABILITY_CONFIG)
    private readonly config: ObservabilityConfig,
  ) {}

  intercept(execution: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (execution.getType() !== 'http') return next.handle();

    const http = execution.switchToHttp();
    const res = http.getResponse<ServerResponse>();
    const capture = this.config.logging.responseBody;

    return next.handle().pipe(
      tap((body: unknown) => {
        if (capture) this.store(res, body);
      }),
      catchError((err: unknown) => {
        this.backfillRoute(http.getRequest());
        if (capture) this.store(res, errorResponseBody(err));
        return throwError(() => err);
      }),
    );
  }

  private store(res: ServerResponse, body: unknown): void {
    const serialized = redactAndSerialize(body, this.config.redaction);
    if (serialized !== undefined) storeCapturedBody(res, serialized);
  }

  /** Without this, traces for requests that matched no handler are named generically. */
  private backfillRoute(request: { originalUrl?: string; url?: string }): void {
    const rpc = getRPCMetadata(otelContext.active());
    if (rpc?.type !== RPCType.HTTP || rpc.route !== undefined) return;

    const path = (request.originalUrl ?? request.url ?? '').split('?')[0];
    if (path) rpc.route = path;
  }
}
