import { Controller, Get, Module, Post, Body } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ObservabilityModule } from '../../../src/nestjs/observability.module';
import { defineConfig } from '../../../src/core/config/define-config';
import { logRequest } from '../../../src/core/logger/request-logger';
import type { ObsLogger } from '../../../src/core/logger/types';

/** Stands in for winston, bunyan, or anything else with these four methods. */
const recordingLogger = () => {
  const entries: Array<{ level: string; record: Record<string, unknown> }> = [];
  const at = (level: string) => (obj: object | string) => {
    entries.push({ level, record: obj as Record<string, unknown> });
  };
  const logger: ObsLogger = {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: () => logger,
  };
  return { entries, logger };
};

describe('logRequest with a non-pino logger', () => {
  const config = defineConfig({}, {});

  const boot = async (sink: ObsLogger) => {
    @Controller()
    class Routes {
      @Post('orders')
      create(@Body() body: unknown) {
        return { created: true, echo: body };
      }
      @Get('missing')
      missing(): never {
        throw new Error('nope');
      }
      @Get('health')
      health() {
        return { ok: true };
      }
    }

    @Module({ imports: [ObservabilityModule.forRoot({ logger: false })], controllers: [Routes] })
    class AppModule {}

    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile())
      .createNestApplication();

    // Whatever your framework gives you: attach on response finish.
    app.use((req: never, res: { on: (e: string, f: () => void) => void }, next: () => void) => {
      res.on('finish', () => logRequest(sink, req, res as never, config));
      next();
    });

    await app.init();
    return app;
  };

  it('logs a request with redacted body through a plain ObsLogger', async () => {
    const { entries, logger } = recordingLogger();
    const app = await boot(logger);

    await request(app.getHttpServer())
      .post('/orders')
      .send({ item: 'widget', password: 'hunter2' });
    await app.close();

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.level).toBe('info');

    const serialized = JSON.stringify(entry?.record);
    expect(serialized).toContain('widget');
    expect(serialized).not.toContain('hunter2');
  });

  it('captures the response body without pino serializers', async () => {
    const { entries, logger } = recordingLogger();
    const app = await boot(logger);

    await request(app.getHttpServer()).post('/orders').send({ item: 'widget' });
    await app.close();

    const res = entries[0]?.record['res'] as { body?: string };
    expect(res?.body).toContain('created');
  });

  it('raises the level for errors', async () => {
    const { entries, logger } = recordingLogger();
    const app = await boot(logger);

    await request(app.getHttpServer()).get('/missing');
    await app.close();

    expect(entries[0]?.level).toBe('error');
  });

  it('skips excluded routes', async () => {
    const { entries, logger } = recordingLogger();
    const app = await boot(logger);

    await request(app.getHttpServer()).get('/health');
    await app.close();

    expect(entries).toEqual([]);
  });
});
