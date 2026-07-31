import { trace, SpanStatusCode, type Attributes, type Span } from '@opentelemetry/api';
import { getTracer } from './handles';

export const withSpan = async <T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> =>
  getTracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      const error = err as Error;
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });

/** Undefined when no span is active — never start one here, it would never be ended. */
export const getRequestContext = (): { traceId: string; spanId: string } | undefined => {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx ? { traceId: ctx.traceId, spanId: ctx.spanId } : undefined;
};
