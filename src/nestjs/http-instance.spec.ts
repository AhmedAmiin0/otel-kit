import { Module, Injectable } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from './observability.module';
import { HttpClientLogger } from './http-client.logger';

@Injectable()
class Caller {
  constructor(readonly http: HttpService) {}
}

const interceptorCount = (http: HttpService): number => {
  const handlers = (http.axiosRef.interceptors.request as unknown as { handlers: unknown[] })
    .handlers;
  return handlers?.filter(Boolean).length ?? 0;
};

const boot = async (moduleClass: unknown) => {
  const app = (await Test.createTestingModule({ imports: [moduleClass as never] }).compile())
    .createNestApplication();
  await app.init();
  return app;
};

describe('HTTP client logging wiring', () => {
  // The module must not import HttpModule itself: HttpModule.register(...) is a
  // distinct dynamic module, so the HttpService it provides is a different
  // instance from the static one. Patching ours would silently miss theirs.
  it('patches the consumer instance when registered beside their HttpModule.register', async () => {
    @Module({
      imports: [
        ObservabilityModule.forRoot({ logger: false }),
        HttpModule.register({ timeout: 5000 }),
      ],
      providers: [Caller, HttpClientLogger],
    })
    class AppModule {}

    const app = await boot(AppModule);
    expect(interceptorCount(app.get(Caller).http)).toBe(1);
    await app.close();
  });

  it('patches the consumer instance with a bare HttpModule too', async () => {
    @Module({
      imports: [ObservabilityModule.forRoot({ logger: false }), HttpModule],
      providers: [Caller, HttpClientLogger],
    })
    class AppModule {}

    const app = await boot(AppModule);
    expect(interceptorCount(app.get(Caller).http)).toBe(1);
    await app.close();
  });

  it('leaves the consumer axios untouched when the logger is not registered', async () => {
    @Module({
      imports: [
        ObservabilityModule.forRoot({ logger: false }),
        HttpModule.register({ timeout: 5000 }),
      ],
      providers: [Caller],
    })
    class AppModule {}

    const app = await boot(AppModule);
    expect(interceptorCount(app.get(Caller).http)).toBe(0);
    await app.close();
  });
});
