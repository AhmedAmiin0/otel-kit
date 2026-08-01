import { registerShutdownHooks } from '../../src/node/shutdown';
import { createDiagnostics } from '../../src/core/diagnostics';

const diag = createDiagnostics('none');

/** @types/node's overloads want a second argument; only the dispatch matters here. */
const raise = (signal: NodeJS.Signals): void => {
  process.emit(signal as never);
};

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('registerShutdownHooks', () => {
  it('registers a listener for SIGTERM and SIGINT', () => {
    const before = {
      term: process.listenerCount('SIGTERM'),
      int: process.listenerCount('SIGINT'),
    };
    const off = registerShutdownHooks({ shutdown: async () => undefined }, diag, {
      exit: () => undefined,
    });

    expect(process.listenerCount('SIGTERM')).toBe(before.term + 1);
    expect(process.listenerCount('SIGINT')).toBe(before.int + 1);
    off();
  });

  it('removes both listeners when unregistered', () => {
    const before = process.listenerCount('SIGTERM');
    registerShutdownHooks({ shutdown: async () => undefined }, diag, { exit: () => undefined })();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('shuts the sdk down and exits 0 on success', async () => {
    const codes: number[] = [];
    let shutdownCalled = false;

    const off = registerShutdownHooks(
      {
        shutdown: async () => {
          shutdownCalled = true;
        },
      },
      diag,
      { exit: (code: number) => codes.push(code) },
    );

    raise('SIGTERM');
    await settle();

    expect(shutdownCalled).toBe(true);
    expect(codes).toEqual([0]);
    off();
  });

  it('exits non-zero when shutdown rejects', async () => {
    const codes: number[] = [];
    const off = registerShutdownHooks(
      {
        shutdown: async () => {
          throw new Error('flush failed');
        },
      },
      diag,
      { exit: (code: number) => codes.push(code) },
    );

    raise('SIGINT');
    await settle();

    expect(codes).toEqual([1]);
    off();
  });

  it('shuts down only once when signalled twice', async () => {
    let calls = 0;
    const off = registerShutdownHooks(
      {
        shutdown: async () => {
          calls += 1;
        },
      },
      diag,
      { exit: () => undefined },
    );

    raise('SIGTERM');
    raise('SIGTERM');
    await settle();

    expect(calls).toBe(1);
    off();
  });
});
