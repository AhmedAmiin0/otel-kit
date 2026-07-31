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

/**
 * Ids of the active span, or undefined when there is none.
 *
 * The previous implementation started a span it never ended whenever no span
 * was active, leaking one span per call.
 */
export const getRequestContext = (): { traceId: string; spanId: string } | undefined => {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx ? { traceId: ctx.traceId, spanId: ctx.spanId } : undefined;
};
