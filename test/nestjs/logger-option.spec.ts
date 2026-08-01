import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bunyan from 'bunyan';
import request from 'supertest';
import winston from 'winston';
import Transport from 'winston-transport';
import { fromObjectFirst } from '../../src/core/logger/adapt';
import type { ObsLogger } from '../../src/core/logger/types';
import { createWinstonLogger } from '../../src/winston/logger';
import { ObservabilityModule } from '../../src/nestjs/observability.module';
import { OBSERVABILITY_LOGGER } from '../../src/nestjs/tokens';

type Entry = Record<string, unknown>;

class CapturingTransport extends Transport {
  readonly entries: Entry[] = [];

  override log(info: Entry, next: () => void): void {
    this.entries.push(info);
    next();
  }
}

/** winston, which takes (message, meta). */
const winstonLogger = (): { logger: ObsLogger; entries: Entry[] } => {
  const transport = new CapturingTransport();
  const instance = winston.createLogger({
    level: 'debug',
    format: winston.format.json(),
    transports: [transport],
  });

  return { logger: createWinstonLogger(instance), entries: transport.entries };
};

/** bunyan, which takes (obj, msg). */
const bunyanLogger = (): { logger: ObsLogger; entries: Entry[] } => {
  const entries: Entry[] = [];
  const instance = bunyan.createLogger({
    name: 'test',
    level: 'debug',
    streams: [
      {
        level: 'debug',
        type: 'raw',
        stream: {
          write: (rec: object) => {
            entries.push(rec as Entry);
          },
        },
      },
    ],
  });

  return { logger: fromObjectFirst(instance as never), entries };
};

@Controller()
class Routes {
  @Post('orders')
  create(@Body() body: unknown) {
    return { id: 'ord_1', echo: body };
  }

  @Get('boom')
  boom(): never {
    throw new Error('kaboom');
  }

  @Get('health')
  health() {
    return { ok: true };
  }
}

/**
 * A real application wired only through the module option, with no middleware
 * registered by hand. That is the thing under test: request logging has to work
 * for a logger that is not pino without the caller assembling it themselves.
 */
const boot = async (logger: ObsLogger) => {
  @Module({
    imports: [
      ObservabilityModule.forRoot({
        logger,
        config: {
          logging: { httpClient: false, excludeRoutes: ['/health'] },
          diagnostics: { level: 'none' },
        },
      }),
    ],
    controllers: [Routes],
  })
  class AppModule {}

  const app = (await Test.createTestingModule({ imports: [AppModule] }).compile())
    .createNestApplication();

  await app.init();
  return app;
};

describe.each([
  ['winston', winstonLogger],
  ['bunyan', bunyanLogger],
])('ObservabilityModule.forRoot({ logger }) with %s', (_name, make) => {
  it('logs a request with no middleware wired up by the caller', async () => {
    const { logger, entries } = make();
    const app = await boot(logger);

    await request(app.getHttpServer()).post('/orders').send({ item: 'widget' });
    await app.close();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveProperty('req');
    expect(entries[0]).toHaveProperty('res');
  });

  it('redacts headers and bodies', async () => {
    const { logger, entries } = make();
    const app = await boot(logger);

    await request(app.getHttpServer())
      .post('/orders')
      .set('authorization', 'Bearer secret-token')
      .send({ item: 'widget', password: 'hunter2' });
    await app.close();

    const written = JSON.stringify(entries[0]);
    expect(written).toContain('widget');
    expect(written).not.toContain('hunter2');
    expect(written).not.toContain('secret-token');
  });

  it('carries the response body the interceptor captured', async () => {
    const { logger, entries } = make();
    const app = await boot(logger);

    await request(app.getHttpServer()).post('/orders').send({ item: 'widget' });
    await app.close();

    expect(JSON.stringify((entries[0] as { res: unknown }).res)).toContain('ord_1');
  });

  it('honours excludeRoutes', async () => {
    const { logger, entries } = make();
    const app = await boot(logger);

    await request(app.getHttpServer()).get('/health');
    await app.close();

    expect(entries).toEqual([]);
  });

  /**
   * Regression guard. Logging from MiddlewareConsumer misses this entirely:
   * the body parser rejects the payload and responds 400 before any middleware
   * runs, so the request never reaches the log.
   */
  it('logs a request whose body the parser rejected', async () => {
    const { logger, entries } = make();
    const app = await boot(logger);

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('content-type', 'application/json')
      .send('{"broken":');
    await app.close();

    expect(res.status).toBe(400);
    expect(entries).toHaveLength(1);
    // Asserted on the record rather than the message, which differs per logger.
    expect((entries[0] as { res: { statusCode: number } }).res.statusCode).toBe(400);
  });

  it('logs each request exactly once', async () => {
    const { logger, entries } = make();
    const app = await boot(logger);

    await request(app.getHttpServer()).post('/orders').send({ item: 'a' });
    await request(app.getHttpServer()).post('/orders').send({ item: 'b' });
    await app.close();

    expect(entries).toHaveLength(2);
  });

  it('echoes the correlation id back on the response', async () => {
    const { logger } = make();
    const app = await boot(logger);

    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('x-request-id', 'abc-123')
      .send({ item: 'widget' });
    await app.close();

    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});

describe('ObservabilityModule.forRoot({ logger }) level mapping', () => {
  it('logs a failed request at error level through winston', async () => {
    const { logger, entries } = winstonLogger();
    const app = await boot(logger);

    await request(app.getHttpServer()).get('/boom');
    await app.close();

    expect((entries[0] as { level: string }).level).toBe('error');
  });

  it('logs a failed request at error level through bunyan', async () => {
    const { logger, entries } = bunyanLogger();
    const app = await boot(logger);

    await request(app.getHttpServer()).get('/boom');
    await app.close();

    // bunyan records levels numerically; 50 is error.
    expect((entries[0] as { level: number }).level).toBe(50);
  });
});

/**
 * The server hook and the interceptor do different jobs. The hook sees req and
 * res, so it can log every request; it cannot see what a handler returned,
 * because that value has not been serialized yet. Capturing it is the
 * interceptor's job, and turning the interceptor off costs exactly that.
 */
describe('interceptor and server hook responsibilities', () => {
  const bootWithout = async (logger: ObsLogger) => {
    @Module({
      imports: [
        ObservabilityModule.forRoot({
          logger,
          interceptor: false,
          config: { logging: { httpClient: false }, diagnostics: { level: 'none' } },
        }),
      ],
      controllers: [Routes],
    })
    class AppModule {}

    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile())
      .createNestApplication();
    await app.init();
    return app;
  };

  it('still logs the request without the interceptor', async () => {
    const { logger, entries } = winstonLogger();
    const app = await bootWithout(logger);

    await request(app.getHttpServer()).post('/orders').send({ item: 'widget' });
    await app.close();

    expect(entries).toHaveLength(1);
    expect((entries[0] as { res: { statusCode: number } }).res.statusCode).toBe(201);
  });

  it('loses the response body without the interceptor', async () => {
    const { logger, entries } = winstonLogger();
    const app = await bootWithout(logger);

    await request(app.getHttpServer()).post('/orders').send({ item: 'widget' });
    await app.close();

    expect((entries[0] as { res: { body?: string } }).res.body).toBeUndefined();
  });

  /** The request body comes off req, which the parser filled in; not from capture. */
  it('keeps the request body, redaction included, without the interceptor', async () => {
    const { logger, entries } = winstonLogger();
    const app = await bootWithout(logger);

    await request(app.getHttpServer())
      .post('/orders')
      .set('authorization', 'Bearer secret-token')
      .send({ item: 'widget', password: 'hunter2' });
    await app.close();

    const body = String((entries[0] as { req: { body?: string } }).req.body);
    expect(body).toContain('widget');
    expect(body).not.toContain('hunter2');
    expect(JSON.stringify(entries[0])).not.toContain('secret-token');
  });
});

describe('ObservabilityModule.forRootAsync({ logger })', () => {
  /** The middleware injects config, so it must see what the factory returned. */
  it('logs using the config the factory produced, not the defaults', async () => {
    const { logger, entries } = winstonLogger();

    @Module({
      imports: [
        ObservabilityModule.forRootAsync({
          logger,
          useFactory: () => ({
            logging: { httpClient: false, excludeRoutes: ['/orders'] },
            diagnostics: { level: 'none' },
          }),
        }),
      ],
      controllers: [Routes],
    })
    class AppModule {}

    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile())
      .createNestApplication();
    await app.init();

    await request(app.getHttpServer()).post('/orders').send({ item: 'widget' });
    await request(app.getHttpServer()).get('/health');
    await app.close();

    // /orders was excluded by the factory config; /health was not.
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0])).toContain('/health');
  });
});

describe('logger option resolution', () => {
  const quiet = { config: { logging: { httpClient: false }, diagnostics: { level: 'none' } } } as const;

  it('registers no logger module when given an instance', () => {
    const { logger } = winstonLogger();
    expect(ObservabilityModule.forRoot({ ...quiet, logger }).imports).toEqual([]);
  });

  it('publishes the instance under a token consumers can inject', () => {
    const { logger } = winstonLogger();
    const provider = (ObservabilityModule.forRoot({ ...quiet, logger }).providers ?? []).find(
      (p) => typeof p === 'object' && p !== null && 'provide' in p && p.provide === OBSERVABILITY_LOGGER,
    );

    expect(provider).toEqual({ provide: OBSERVABILITY_LOGGER, useValue: logger });
    expect(ObservabilityModule.forRoot({ ...quiet, logger }).exports).toContain(
      OBSERVABILITY_LOGGER,
    );
  });

  it('still treats a function as the pino config customizer', () => {
    let seen: unknown;
    ObservabilityModule.forRoot({
      ...quiet,
      logger: (defaults) => {
        seen = defaults;
        return defaults;
      },
    });

    expect(seen).toHaveProperty('pinoHttp');
  });
});
