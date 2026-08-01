import {
  Controller,
  Get,
  Module,
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ObservabilityModule } from '../../src/nestjs/observability.module';

/** A consumer's own global error handler, of the kind every real app has. */
@Catch()
class ConsumerFilter implements ExceptionFilter {
  catch(_exception: unknown, host: ArgumentsHost): void {
    host.switchToHttp().getResponse().status(418).json({ handledBy: 'consumer' });
  }
}

@Controller()
class Routes {
  @Get('boom')
  boom(): never {
    throw new Error('kaboom');
  }
}

const buildApp = async (providers: unknown[] = []) => {
  @Module({
    imports: [ObservabilityModule.forRoot({ logger: false })],
    controllers: [Routes],
    providers: providers as never[],
  })
  class AppModule {}

  const app = (await Test.createTestingModule({ imports: [AppModule] }).compile())
    .createNestApplication();
  await app.init();
  return app;
};

describe('coexistence with a consumer exception filter', () => {
  // Importing this package must never take over the application's error
  // handling. A global APP_FILTER would: the token is not cumulative, so ours
  // would win and the consumer's filter would never run.
  it('leaves the consumer filter in charge of the response', async () => {
    const app = await buildApp([{ provide: APP_FILTER, useClass: ConsumerFilter }]);

    const res = await request(app.getHttpServer()).get('/boom');
    await app.close();

    expect(res.status).toBe(418);
    expect(res.body).toEqual({ handledBy: 'consumer' });
  });

  it('registers no global exception filter at all', () => {
    const mod = ObservabilityModule.forRoot({ logger: false });
    const classes = (mod.providers ?? []).flatMap((p) => {
      const useClass = (p as { useClass?: { name: string } }).useClass;
      return useClass ? [useClass.name] : [];
    });

    expect(classes).toEqual(['ResponseBodyInterceptor']);
  });

  it('still serves errors when the consumer has no filter of their own', async () => {
    const app = await buildApp();

    const res = await request(app.getHttpServer()).get('/boom');
    await app.close();

    expect(res.status).toBe(500);
  });
});
