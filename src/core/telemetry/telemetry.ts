import type { Attributes, Counter, Histogram, Span } from '@opentelemetry/api';
import { getMeter } from './handles';
import { getRequestContext, withSpan } from './spans';

/**
 * Convenience facade over the OTel API with instrument caching.
 *
 * Undecorated on purpose: core carries no Nest dependency. The Nest adapter
 * subclasses this with @Injectable().
 */
export class Telemetry {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  withSpan<T>(name: string, fn: (span: Span) => Promise<T>, attributes?: Attributes): Promise<T> {
    return withSpan(name, fn, attributes);
  }

  counter(name: string, description?: string): Counter {
    const existing = this.counters.get(name);
    if (existing) return existing;

    const created = getMeter().createCounter(name, { description });
    this.counters.set(name, created);
    return created;
  }

  histogram(name: string, description?: string, unit?: string): Histogram {
    const existing = this.histograms.get(name);
    if (existing) return existing;

    const created = getMeter().createHistogram(name, { description, unit });
    this.histograms.set(name, created);
    return created;
  }

  increment(name: string, attributes?: Attributes, value = 1): void {
    this.counter(name).add(value, attributes);
  }

  /** Undefined when no span is active. */
  getContext(): { traceId: string; spanId: string } | undefined {
    return getRequestContext();
  }
}
