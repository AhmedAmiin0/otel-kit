import type { IncomingMessage, ServerResponse } from 'node:http';
import { sanitizeHeaders, httpLogLevel } from './serializers';

describe('sanitizeHeaders', () => {
  it('masks known sensitive headers case-insensitively', () => {
    const out = sanitizeHeaders(
      { Authorization: 'Bearer x', 'x-api-key': 'k', accept: 'json' },
      'XXX',
    );
    expect(out).toEqual({ Authorization: 'XXX', 'x-api-key': 'XXX', accept: 'json' });
  });

  it('leaves an empty header bag empty', () => {
    expect(sanitizeHeaders({}, 'XXX')).toEqual({});
  });
});

describe('httpLogLevel', () => {
  const req = {} as IncomingMessage;
  const res = (statusCode: number) => ({ statusCode }) as ServerResponse;

  it.each([
    [200, 'info'],
    [301, 'silent'],
    [404, 'warn'],
    [500, 'error'],
  ])('maps %i to %s', (status, expected) => {
    expect(httpLogLevel(req, res(status as number))).toBe(expected);
  });

  it('reports error when an error is present regardless of status', () => {
    expect(httpLogLevel(req, res(200), new Error('boom'))).toBe('error');
  });
});
