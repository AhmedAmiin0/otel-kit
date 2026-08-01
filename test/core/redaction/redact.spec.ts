import { redactBody, serializeBody, redactAndSerialize } from '../../../src/core/redaction/redact';
import type { RedactionConfig } from '../../../src/core/config/types';

const redaction: RedactionConfig = {
  keys: new Set(['password', 'token']),
  placeholder: 'XXX',
  bodyMaxChars: 20,
  maxDepth: 3,
  maxNodes: 1000,
};

describe('redactBody', () => {
  it('masks matching keys case-insensitively', () => {
    expect(redactBody({ Password: 'hunter2', ok: 1 }, redaction)).toEqual({
      Password: 'XXX',
      ok: 1,
    });
  });

  it('recurses into nested objects and arrays', () => {
    expect(redactBody({ a: [{ token: 't' }] }, redaction)).toEqual({ a: [{ token: 'XXX' }] });
  });

  it('stops at the configured depth', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(JSON.stringify(redactBody(deep, redaction))).toContain('MaxDepth');
  });

  it('returns primitives and null unchanged', () => {
    expect(redactBody('plain', redaction)).toBe('plain');
    expect(redactBody(null, redaction)).toBeNull();
    expect(redactBody(42, redaction)).toBe(42);
  });
});

describe('redactBody node budget', () => {
  const budgeted = (maxNodes: number): RedactionConfig => ({ ...redaction, maxNodes });

  it('stops walking once the budget is exhausted', () => {
    const wide = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    const out = redactBody(wide, budgeted(10)) as Record<string, unknown>;

    expect(Object.keys(out).length).toBeLessThan(50);
    expect(out['...']).toBe('[Truncated]');
  });

  it('truncates long arrays rather than copying every element', () => {
    const out = redactBody(Array.from({ length: 500 }, (_, i) => i), budgeted(10)) as unknown[];

    expect(out.length).toBeLessThan(500);
    expect(out[out.length - 1]).toBe('[Truncated]');
  });

  it('does not visit more values than the budget allows', () => {
    let visits = 0;
    const probe = new Proxy(
      { a: { b: { c: 1 } }, d: 2, e: 3 },
      {
        ownKeys(target) {
          visits += 1;
          return Reflect.ownKeys(target);
        },
      },
    );

    redactBody(probe, budgeted(2));
    expect(visits).toBeLessThanOrEqual(2);
  });

  it('leaves small payloads completely intact', () => {
    const small = { a: 1, nested: { b: 2 } };
    expect(redactBody(small, budgeted(1000))).toEqual(small);
  });

  it('still redacts sensitive keys encountered before the budget runs out', () => {
    const out = redactBody({ password: 'hunter2', a: 1, b: 2 }, budgeted(3)) as Record<
      string,
      unknown
    >;
    expect(out['password']).toBe('XXX');
  });

  it('bounds work on a deeply nested payload without throwing', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 5000; i += 1) deep = { nested: deep };

    expect(() => redactBody(deep, budgeted(100))).not.toThrow();
  });
});

describe('serializeBody', () => {
  it('returns undefined for undefined', () => {
    expect(serializeBody(undefined, 20)).toBeUndefined();
  });

  it('passes short strings through', () => {
    expect(serializeBody('short', 20)).toBe('short');
  });

  it('truncates past the limit and says so', () => {
    const result = serializeBody('x'.repeat(50), 20);
    expect(result).toContain('max 20 chars');
    expect(result?.startsWith('x'.repeat(20))).toBe(true);
  });

  it('reports unserializable input rather than throwing', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(serializeBody(circular, 20)).toBe('[Unserializable]');
  });
});

describe('redactAndSerialize', () => {
  it('redacts before serializing', () => {
    expect(redactAndSerialize({ token: 'secret' }, redaction)).toContain('XXX');
  });

  it('never leaks a redacted value into the output', () => {
    expect(redactAndSerialize({ password: 'hunter2' }, redaction)).not.toContain('hunter2');
  });
});
