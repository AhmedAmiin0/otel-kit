import type { ServerResponse } from 'node:http';
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { observabilityConfig } from '../config';
import { storeCapturedBody } from './body-capture';
import { redactAndSerialize } from './redact';

@Injectable()
export class RequestBodyInterceptor implements NestInterceptor {
  constructor(
    @Inject(observabilityConfig.KEY)
    private readonly config: ConfigType<typeof observabilityConfig>,
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
