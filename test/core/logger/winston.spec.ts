import { Controller, Get, Module, Post, Body } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import winston from 'winston';
import Transport from 'winston-transport';
import { ObservabilityModule } from '../../../src/nestjs/observability.module';
import { defineConfig } from '../../../src/core/config/define-config';
import { logRequest } from '../../../src/core/logger/request-logger';
// The shipped binding, so this exercises what consumers actually get.
import { createWinstonLogger } from '../../../src/winston/logger';

/** Captures what winston actually emitted, after its own formatting. */
class CapturingTransport extends Transport {
  readonly entries: Array<Record<string, unknown>> = [];

  override log(info: Record<string, unknown>, next: () => void): void {
    this.entries.push(info);
    next();
  }
}

describe('winston integration', () => {
  const config = defineConfig({}, {});

  const boot = async () => {
    const transport = new CapturingTransport();
    const wl = winston.createLogger({
      level: 'debug',
      format: winston.format.json(),
      transports: [transport],
    });

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
    }

    @Module({ imports: [ObservabilityModule.forRoot({ logger: false })], controllers: [Routes] })
    class AppModule {}

    const app = (await Test.createTestingModule({ imports: [AppModule] }).compile())
      .createNestApplication();

    const obs = createWinstonLogger(wl);
    app.use((req: never, res: { on: (e: string, f: () => void) => void }, next: () => void) => {
      res.on('finish', () => logRequest(obs, req, res as never, config));
      next();
    });

    await app.init();
    return { app, transport };
  };

  it('emits a request record through real winston', async () => {
    const { app, transport } = await boot();

    await request(app.getHttpServer())
      .post('/orders')
      .set('authorization', 'Bearer secret-token')
      .send({ item: 'widget', password: 'hunter2' });
    await app.close();

    expect(transport.entries).toHaveLength(1);
    const entry = transport.entries[0] as { level: string; req: unknown; res: unknown };

    expect(entry.level).toBe('info');
    expect(entry.req).toBeDefined();
    expect(entry.res).toBeDefined();
  });

  it('redacts bodies and headers in what winston writes', async () => {
    const { app, transport } = await boot();

    await request(app.getHttpServer())
      .post('/orders')
      .set('authorization', 'Bearer secret-token')
      .send({ item: 'widget', password: 'hunter2' });
    await app.close();

    const written = JSON.stringify(transport.entries[0]);
    expect(written).toContain('widget');
    expect(written).not.toContain('hunter2');
    expect(written).not.toContain('secret-token');
  });

  it('carries the captured response body', async () => {
    const { app, transport } = await boot();

    await request(app.getHttpServer()).post('/orders').send({ item: 'widget' });
    await app.close();

    const res = (transport.entries[0] as { res: { body?: string } }).res;
    expect(res.body).toContain('ord_1');
  });

  it('maps a 500 to winston error level', async () => {
    const { app, transport } = await boot();

    await request(app.getHttpServer()).get('/boom');
    await app.close();

    expect((transport.entries[0] as { level: string }).level).toBe('error');
  });
});
