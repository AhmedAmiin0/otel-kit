import bunyan from 'bunyan';
import log4js from 'log4js';
import winston from 'winston';
import Transport from 'winston-transport';
import { fromMessageFirst, fromObjectFirst } from '../../../src/core/logger/adapt';

describe('fromObjectFirst with real bunyan', () => {
  const setup = () => {
    const records: Array<Record<string, unknown>> = [];
    const bl = bunyan.createLogger({
      name: 'test',
      level: 'debug',
      streams: [
        {
          type: 'raw',
          stream: {
            write: (r: unknown) => {
              records.push(r as Record<string, unknown>);
            },
          },
        },
      ],
    });
    return { records, logger: fromObjectFirst(bl as never) };
  };

  it('passes the object through and keeps the message', () => {
    const { records, logger } = setup();
    logger.info({ orderId: 'ord_1' }, 'created');

    expect(records[0]?.['msg']).toBe('created');
    expect(records[0]?.['orderId']).toBe('ord_1');
  });

  it('accepts a bare string', () => {
    const { records, logger } = setup();
    logger.warn('careful');
    expect(records[0]?.['msg']).toBe('careful');
  });

  it('maps levels to bunyan numeric levels', () => {
    const { records, logger } = setup();
    logger.error({ a: 1 }, 'bad');
    expect(records[0]?.['level']).toBe(bunyan.ERROR);
  });

  it('uses bunyan native child bindings', () => {
    const { records, logger } = setup();
    logger.child({ svc: 'api' }).info({ a: 1 }, 'x');
    expect(records[0]?.['svc']).toBe('api');
  });
});

describe('fromMessageFirst with real log4js', () => {
  const setup = () => {
    log4js.configure({
      appenders: { rec: { type: 'recording' } },
      categories: { default: { appenders: ['rec'], level: 'debug' } },
    });
    log4js.recording().erase();
    return { logger: fromMessageFirst(log4js.getLogger() as never) };
  };

  it('sends the message first and the object as meta', () => {
    const { logger } = setup();
    logger.info({ orderId: 'ord_1' }, 'created');

    const [event] = log4js.recording().replay();
    expect(event?.data[0]).toBe('created');
    expect(event?.data[1]).toMatchObject({ orderId: 'ord_1' });
  });

  it('records the level', () => {
    const { logger } = setup();
    logger.error({ a: 1 }, 'bad');
    expect(log4js.recording().replay()[0]?.level.levelStr).toBe('ERROR');
  });

  // log4js has no child concept, so the adapter carries bindings itself.
  it('merges child bindings even though log4js has no child', () => {
    const { logger } = setup();
    logger.child({ svc: 'api' }).info({ a: 1 }, 'x');

    expect(log4js.recording().replay()[0]?.data[1]).toMatchObject({ svc: 'api', a: 1 });
  });
});

describe('fromMessageFirst with real winston', () => {
  it('produces the same record shape as the dedicated binding', () => {
    const entries: Array<Record<string, unknown>> = [];
    class Capture extends Transport {
      override log(info: Record<string, unknown>, next: () => void): void {
        entries.push(info);
        next();
      }
    }
    const wl = winston.createLogger({
      level: 'debug',
      format: winston.format.json(),
      transports: [new Capture()],
    });

    fromMessageFirst(wl as never).info({ orderId: 'ord_1' }, 'created');

    expect(entries[0]?.['message']).toBe('created');
    expect(entries[0]?.['orderId']).toBe('ord_1');
  });
});
