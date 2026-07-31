import { createDiagnostics } from './diagnostics';

const sink = () => {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    write: (level: string, msg: string) => {
      calls.push([level, msg]);
    },
  };
};

describe('createDiagnostics', () => {
  it('suppresses everything at level none', () => {
    const s = sink();
    const diag = createDiagnostics('none', s.write);
    diag.error('boom');
    diag.debug('detail');
    expect(s.calls).toEqual([]);
  });

  it('emits at or above the configured level', () => {
    const s = sink();
    const diag = createDiagnostics('warn', s.write);
    diag.error('e');
    diag.warn('w');
    diag.info('i');
    diag.debug('d');
    expect(s.calls).toEqual([
      ['error', 'e'],
      ['warn', 'w'],
    ]);
  });

  it('emits everything at debug', () => {
    const s = sink();
    const diag = createDiagnostics('debug', s.write);
    diag.debug('d');
    expect(s.calls).toEqual([['debug', 'd']]);
  });

  it('routes log(level, message) through the same gate', () => {
    const s = sink();
    const diag = createDiagnostics('warn', s.write);
    diag.log('debug', 'hidden');
    diag.log('warn', 'shown');
    expect(s.calls).toEqual([['warn', 'shown']]);
  });

  it('prefixes messages so the source is identifiable', () => {
    const s = sink();
    createDiagnostics('info', s.write).info('hello');
    expect(s.calls[0]?.[1]).toContain('hello');
  });
});
