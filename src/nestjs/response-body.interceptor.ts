import type { ServerResponse } from 'node:http';
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { ObservabilityConfig } from '../core/config/types';
import { OBSERVABILITY_CONFIG } from './tokens';
import { storeCapturedBody } from '../core/redaction/body-capture';
import { redactAndSerialize } from '../core/redaction/redact';

@Injectable()
export class ResponseBodyInterceptor implements NestInterceptor {
  constructor(
    @Inject(OBSERVABILITY_CONFIG)
    private readonly config: ObservabilityConfig,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.config.logging.responseBody) return next.handle();
    if (context.getType() !== 'http') return next.handle();

    const res = context.switchToHttp().getResponse<ServerResponse>();

    return next.handle().pipe(
      tap((body: unknown) => {
        const serialized = redactAndSerialize(body, this.config.redaction);
        if (serialized !== undefined) {
          storeCapturedBody(res, serialized);
        }
      }),
    );
  }
}
