import { Module, Injectable } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { Test } from '@nestjs/testing';
import { ObservabilityModule } from '../../src/nestjs/observability.module';

@Injectable()
class Caller {
  constructor(readonly http: HttpService) {}
}

const interceptorCount = (http: HttpService): number =>
  ((http.axiosRef.interceptors.request as unknown as { handlers: unknown[] }).handlers ?? []).filter(
    Boolean,
  ).length;

const boot = async (moduleClass: unknown) => {
  const app = (await Test.createTestingModule({ imports: [moduleClass as never] }).compile())
    .createNestApplication();
  await app.init();
  return app;
};

describe('outbound HTTP logging auto-registers', () => {
  // The logger resolves HttpService from the container instead of having it
  // injected, so it must reach the instance the consumer actually calls
  // through — including the distinct one HttpModule.register(...) provides.
  it('patches the instance from HttpModule.register', async () => {
    @Module({
      imports: [ObservabilityModule.forRoot({ logger: false }), HttpModule.register({ timeout: 5000 })],
      providers: [Caller],
    })
    class AppModule {}

    const app = await boot(AppModule);
    expect(interceptorCount(app.get(Caller).http)).toBe(1);
    await app.close();
  });

  it('patches the instance from a bare HttpModule', async () => {
    @Module({
      imports: [ObservabilityModule.forRoot({ logger: false }), HttpModule],
      providers: [Caller],
    })
    class AppModule {}

    const app = await boot(AppModule);
    expect(interceptorCount(app.get(Caller).http)).toBe(1);
    await app.close();
  });

  it('boots cleanly when no HttpModule is imported at all', async () => {
    @Module({ imports: [ObservabilityModule.forRoot({ logger: false })] })
    class AppModule {}

    const app = await boot(AppModule);
    expect(app).toBeDefined();
    await app.close();
  });

  it('does not patch when LOG_HTTP_CLIENT is off', async () => {
    @Module({
      imports: [
        ObservabilityModule.forRoot({ logger: false, config: { logging: { httpClient: false } } }),
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
