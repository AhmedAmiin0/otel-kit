import { resolveInstrumentations, type ResolverDeps } from './resolve';
import type { InstrumentationDescriptor } from './types';
import type { Diagnostics } from '../../core/diagnostics';

class FakeInstrumentation {
  instrumentationName = 'fake';
  instrumentationVersion = '1.0.0';
  constructor(public readonly config: Record<string, unknown>) {}
  enable(): void {}
  disable(): void {}
}

const recorder = () => {
  const lines: Array<[string, string]> = [];
  const push = (level: string) => (msg: string) => {
    lines.push([level, msg]);
  };
  const diag: Diagnostics = {
    log: (level, msg) => {
      lines.push([level, msg]);
    },
    error: push('error'),
    warn: push('warn'),
    info: push('info'),
    debug: push('debug'),
  };
  return { lines, diag };
};

const deps = (present: string[], exports?: Record<string, unknown>): ResolverDeps => ({
  canResolve: (id: string) => present.includes(id),
  requireOptional: (id: string) => exports?.[id] ?? { FakeInstrumentation },
});

const d = (over: Partial<InstrumentationDescriptor>): InstrumentationDescriptor => ({
  name: 'x',
  module: 'mod-x',
  ...over,
});

describe('resolveInstrumentations', () => {
  it('constructs an instrumentation when both gates pass', () => {
    const { diag } = recorder();
    const result = resolveInstrumentations(
      [d({ export: 'FakeInstrumentation' })],
      diag,
      deps(['mod-x']),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(FakeInstrumentation);
  });

  it('passes the descriptor config to the constructor', () => {
    const { diag } = recorder();
    const [made] = resolveInstrumentations(
      [d({ export: 'FakeInstrumentation', config: { a: 1 } })],
      diag,
      deps(['mod-x']),
    );
    expect((made as unknown as FakeInstrumentation).config).toEqual({ a: 1 });
  });

  it('skips a descriptor that is explicitly disabled', () => {
    const { diag } = recorder();
    expect(resolveInstrumentations([d({ enabled: false })], diag, deps(['mod-x']))).toHaveLength(0);
  });

  it('skips when the instrumented library is absent', () => {
    const { diag } = recorder();
    expect(
      resolveInstrumentations([d({ requires: 'typeorm' })], diag, deps(['mod-x'])),
    ).toHaveLength(0);
  });

  it('skips when the instrumentation package is absent', () => {
    const { diag } = recorder();
    expect(resolveInstrumentations([d({})], diag, deps([]))).toHaveLength(0);
  });

  it('logs at debug when a defaulted descriptor is unavailable', () => {
    const { lines, diag } = recorder();
    resolveInstrumentations([d({ requires: 'typeorm' })], diag, deps([]));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every(([level]) => level === 'debug')).toBe(true);
  });

  it('logs at warn when an explicit descriptor is unavailable', () => {
    const { lines, diag } = recorder();
    resolveInstrumentations([d({ requires: 'typeorm', explicit: true })], diag, deps([]));
    expect(lines.some(([level]) => level === 'warn')).toBe(true);
  });

  it('names the package to install in the message', () => {
    const { lines, diag } = recorder();
    resolveInstrumentations([d({ module: '@otel/thing', explicit: true })], diag, deps([]));
    expect(lines.map(([, msg]) => msg).join(' ')).toContain('@otel/thing');
  });

  it('never throws when a package is missing', () => {
    const { diag } = recorder();
    expect(() => resolveInstrumentations([d({})], diag, deps([]))).not.toThrow();
  });

  it('skips a module that exports no usable constructor', () => {
    const { lines, diag } = recorder();
    const result = resolveInstrumentations([d({ export: 'Missing' })], diag, {
      canResolve: () => true,
      requireOptional: () => ({ Missing: 'not a function' }),
    });
    expect(result).toHaveLength(0);
    expect(lines.some(([level]) => level === 'warn')).toBe(true);
  });

  it('falls back to the default export when no export name is given', () => {
    const { diag } = recorder();
    const result = resolveInstrumentations([d({})], diag, {
      canResolve: () => true,
      requireOptional: () => ({ default: FakeInstrumentation }),
    });
    expect(result).toHaveLength(1);
  });

  it('survives a constructor that throws and keeps going', () => {
    const { diag } = recorder();
    class Boom {
      constructor() {
        throw new Error('bad');
      }
    }
    const result = resolveInstrumentations(
      [
        d({ name: 'boom', module: 'a', export: 'Boom' }),
        d({ name: 'ok', module: 'b', export: 'FakeInstrumentation' }),
      ],
      diag,
      {
        canResolve: () => true,
        requireOptional: (id: string) => (id === 'a' ? { Boom } : { FakeInstrumentation }),
      },
    );
    expect(result).toHaveLength(1);
  });

  it('resolves several descriptors in order', () => {
    const { diag } = recorder();
    const result = resolveInstrumentations(
      [
        d({ name: 'a', module: 'a', export: 'FakeInstrumentation' }),
        d({ name: 'b', module: 'b', export: 'FakeInstrumentation' }),
      ],
      diag,
      { canResolve: () => true, requireOptional: () => ({ FakeInstrumentation }) },
    );
    expect(result).toHaveLength(2);
  });
});
