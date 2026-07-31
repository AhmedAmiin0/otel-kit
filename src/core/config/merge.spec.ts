import { deepMerge } from './merge';

describe('deepMerge', () => {
  it('preserves sibling keys the override does not mention', () => {
    const base = { logging: { level: 'info', pretty: true, headers: true } };
    const result = deepMerge(base, { logging: { level: 'debug' } });
    expect(result).toEqual({ logging: { level: 'debug', pretty: true, headers: true } });
  });

  it('replaces arrays instead of concatenating them', () => {
    const base = { traces: { ignoreRoutes: ['/health', '/metrics'] } };
    const result = deepMerge(base, { traces: { ignoreRoutes: ['/ping'] } });
    expect(result.traces.ignoreRoutes).toEqual(['/ping']);
  });

  it('replaces class instances wholesale rather than merging their fields', () => {
    class FakeExporter {
      constructor(public readonly id: string) {}
    }
    const base = { traces: { exporter: new FakeExporter('a') } };
    const next = new FakeExporter('b');
    const result = deepMerge(base, { traces: { exporter: next } });
    expect(result.traces.exporter).toBe(next);
  });

  it('ignores undefined override values', () => {
    const base = { service: { name: 'svc', version: '1.0.0' } };
    const result = deepMerge(base, { service: { name: undefined } });
    expect(result.service.name).toBe('svc');
  });

  it('does not mutate the base object', () => {
    const base = { logging: { level: 'info' } };
    deepMerge(base, { logging: { level: 'debug' } });
    expect(base.logging.level).toBe('info');
  });

  it('applies later overrides over earlier ones', () => {
    const result = deepMerge({ a: 1 }, { a: 2 }, { a: 3 });
    expect(result.a).toBe(3);
  });
});
