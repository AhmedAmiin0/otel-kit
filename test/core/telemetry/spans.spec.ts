import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { withSpan, getRequestContext } from '../../../src/core/telemetry/spans';
import { resetTelemetryHandles } from '../../../src/core/telemetry/handles';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  // Without a context manager, context.active() always returns ROOT_CONTEXT,
  // so startActiveSpan never establishes a parent and nesting silently fails.
  // In production NodeSDK registers this; the test harness must do it itself.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

beforeEach(() => {
  exporter.reset();
  resetTelemetryHandles();
});

describe('withSpan', () => {
  it('returns the callback result', async () => {
    await expect(withSpan('op', async () => 42)).resolves.toBe(42);
  });

  it('ends the span on success', async () => {
    await withSpan('op', async () => 1);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('op');
  });

  it('rethrows, records the exception, and sets ERROR status', async () => {
    await expect(
      withSpan('bad', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const span = exporter.getFinishedSpans()[0];
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.status.message).toBe('boom');
    expect(span?.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('ends the span even when the callback throws', async () => {
    await expect(
      withSpan('bad', async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();
    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it('applies the supplied attributes', async () => {
    await withSpan('op', async () => 1, { 'user.id': '7' });
    expect(exporter.getFinishedSpans()[0]?.attributes).toMatchObject({ 'user.id': '7' });
  });

  it('nests a child span under an active parent', async () => {
    await withSpan('parent', async () => {
      await withSpan('child', async () => 1);
    });

    const [child, parent] = exporter.getFinishedSpans();
    expect(child?.name).toBe('child');
    expect(parent?.name).toBe('parent');
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });
});

describe('getRequestContext', () => {
  it('returns undefined when no span is active', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('does not leak a span when no span is active', () => {
    getRequestContext();
    getRequestContext();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it('returns the ids of the active span', async () => {
    expect.assertions(2);
    await withSpan('op', async () => {
      const ctx = getRequestContext();
      const active = trace.getActiveSpan()?.spanContext();
      expect(ctx?.traceId).toBe(active?.traceId);
      expect(ctx?.spanId).toBe(active?.spanId);
    });
  });
});
