import { createConsoleLogger } from './console';
import { noopLogger } from './noop';

describe('noopLogger', () => {
  it('accepts every method without throwing', () => {
    expect(() => {
      noopLogger.debug('a');
      noopLogger.info({ a: 1 }, 'b');
      noopLogger.warn('c');
      noopLogger.error('d');
      noopLogger.child({ x: 1 }).info('e');
    }).not.toThrow();
  });

  it('returns a logger from child', () => {
    expect(typeof noopLogger.child({}).info).toBe('function');
  });
});

describe('createConsoleLogger', () => {
  let written: string[];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    written = [];
    spy = jest.spyOn(console, 'log').mockImplementation((line: unknown) => {
      written.push(String(line));
    });
  });

  afterEach(() => spy.mockRestore());

  it('suppresses messages below the configured level', () => {
    createConsoleLogger('warn').info('hidden');
    expect(written).toEqual([]);
  });

  it('emits messages at or above the configured level', () => {
    createConsoleLogger('warn').warn('shown');
    expect(written.join('')).toContain('shown');
  });

  it('merges child bindings into the output', () => {
    createConsoleLogger('info').child({ svc: 'api' }).info('hello');
    const line = written.join('');
    expect(line).toContain('svc');
    expect(line).toContain('hello');
  });

  it('accepts an object as the first argument', () => {
    createConsoleLogger('info').info({ event: 'started' });
    expect(written.join('')).toContain('started');
  });

  it('accumulates bindings across nested children', () => {
    createConsoleLogger('info').child({ a: 1 }).child({ b: 2 }).info('x');
    const line = written.join('');
    expect(line).toContain('"a":1');
    expect(line).toContain('"b":2');
  });
});
