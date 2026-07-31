import { redactBody, serializeBody, redactAndSerialize } from './redact';
import type { RedactionConfig } from '../config/types';

const redaction: RedactionConfig = {
  keys: new Set(['password', 'token']),
  placeholder: 'XXX',
  bodyMaxChars: 20,
  maxDepth: 3,
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
