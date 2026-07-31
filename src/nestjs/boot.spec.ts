import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ObservabilityModule } from './observability.module';
import { OBSERVABILITY_CONFIG } from './tokens';
import { TelemetryService } from './telemetry.service';

@Controller()
class Routes {
  @Get('ok') ok() { return { v: 1 }; }
}

const boot = async (mod: ReturnType<typeof ObservabilityModule.forRoot>) => {
  @Module({ imports: [mod], controllers: [Routes] })
  class AppModule {}
  const app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
  await app.init();
  return app;
};

describe('module boots for real', () => {
  it('forRoot resolves every provider it declares', async () => {
    const app = await boot(ObservabilityModule.forRoot({ logger: false }));
    expect(app.get(OBSERVABILITY_CONFIG)).toBeDefined();
    expect(app.get(TelemetryService)).toBeInstanceOf(TelemetryService);
    const res = await request(app.getHttpServer()).get('/ok');
    expect(res.status).toBe(200);
    await app.close();
  });

  it('forRoot boots with http client logging enabled', async () => {
    const app = await boot(
      ObservabilityModule.forRoot({ logger: false, config: { logging: { httpClient: true } } }),
    );
    const res = await request(app.getHttpServer()).get('/ok');
    expect(res.status).toBe(200);
    await app.close();
  });

  it('forRootAsync resolves every provider it declares', async () => {
    const app = await boot(
      ObservabilityModule.forRootAsync({ useFactory: () => ({ service: { name: 'async-svc' } }) }),
    );
    const cfg = app.get(OBSERVABILITY_CONFIG) as { service: { name: string } };
    expect(cfg.service.name).toBe('async-svc');
    expect(app.get(TelemetryService)).toBeInstanceOf(TelemetryService);
    await app.close();
  });
});
