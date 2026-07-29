import {
  trace,
  metrics,
  SpanStatusCode,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { loadObservabilityConfig } from '../config';

const { name, version } = loadObservabilityConfig().service;

export const tracer = trace.getTracer(name, version);

export const meter = metrics.getMeter(name, version);
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
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
}

export function getRequestContext(name: string): {
  traceId: string;
  spanId: string;
} {
  const span = trace.getActiveSpan() ?? tracer.startSpan(name);
  return {
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
  };
}
