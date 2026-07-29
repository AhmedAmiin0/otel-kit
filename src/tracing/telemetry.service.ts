import { Injectable } from '@nestjs/common';
import type { Attributes, Counter, Histogram, Span } from '@opentelemetry/api';
import { getRequestContext, meter, withSpan } from './tracer';
@Injectable()
export class TelemetryService {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attributes?: Attributes,
  ): Promise<T> {
    return withSpan(name, fn, attributes);
  }

  counter(name: string, description?: string): Counter {
    const existing = this.counters.get(name);
    if (existing) return existing;

    const created = meter.createCounter(name, { description });
    this.counters.set(name, created);
    return created;
  }

  histogram(name: string, description?: string, unit?: string): Histogram {
    const existing = this.histograms.get(name);
    if (existing) return existing;

    const created = meter.createHistogram(name, { description, unit });
    this.histograms.set(name, created);
    return created;
  }

  increment(name: string, attributes?: Attributes, value = 1): void {
    this.counter(name).add(value, attributes);
  }

  getContext(name: string): { traceId: string; spanId: string } {
    return getRequestContext(name);
  }
}
