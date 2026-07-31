import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { Telemetry } from './telemetry';
import { resetTelemetryHandles } from './handles';

// A real MeterProvider is required for these assertions to mean anything:
// the default NoopMeter returns one shared singleton from createCounter
// regardless of name, so identity checks would pass or fail for reasons
// that have nothing to do with Telemetry's caching.
beforeAll(() => {
  metrics.setGlobalMeterProvider(new MeterProvider());
  resetTelemetryHandles();
});

describe('Telemetry', () => {
  it('returns the same counter instance for the same name', () => {
    const t = new Telemetry();
    expect(t.counter('a')).toBe(t.counter('a'));
  });

  it('returns different counters for different names', () => {
    const t = new Telemetry();
    expect(t.counter('a')).not.toBe(t.counter('b'));
  });

  it('caches histograms the same way', () => {
    const t = new Telemetry();
    expect(t.histogram('h')).toBe(t.histogram('h'));
  });

  it('keeps counter and histogram caches separate', () => {
    const t = new Telemetry();
    const counter = t.counter('same');
    const histogram = t.histogram('same');
    expect(counter).not.toBe(histogram);
  });

  it('does not share caches between instances', () => {
    expect(new Telemetry().counter('a')).not.toBe(new Telemetry().counter('a'));
  });

  it('increments through the cached counter without throwing', () => {
    const t = new Telemetry();
    expect(() => t.increment('requests', { route: '/a' })).not.toThrow();
    expect(() => t.increment('requests', undefined, 5)).not.toThrow();
  });

  it('delegates withSpan and returns the callback result', async () => {
    await expect(new Telemetry().withSpan('op', async () => 'done')).resolves.toBe('done');
  });

  it('returns undefined from getContext with no active span', () => {
    expect(new Telemetry().getContext()).toBeUndefined();
  });
});
