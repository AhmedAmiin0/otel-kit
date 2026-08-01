import { startObservability } from 'otel-kit/node';

/**
 * The SDK starts before anything else loads, so instrumentation can patch
 * modules on their way in. The application is pulled in with dynamic imports
 * for that reason: static imports are hoisted above this call.
 *
 * `node -r otel-kit/register` does the same thing from the command line and
 * reads its config from the environment.
 */
const handle = startObservability({
  service: { name: 'otel-kit-demo', version: '0.1.0' },
  traces: { exporter: 'console' },
  metrics: { exporter: 'none' },
  logs: { exporter: 'none' },
  diagnostics: { level: 'debug' },
});

const PORT = Number(process.env.PORT ?? 3000);

const bootstrap = async (): Promise<void> => {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');

  const app = await NestFactory.create(AppModule);
  await app.listen(PORT);

  console.log(`\ndemo listening on http://localhost:${PORT}\n`);
  console.log('Try:\n');
  console.log(`  curl -X POST http://localhost:${PORT}/posts \\`);
  console.log(`    -H 'content-type: application/json' \\`);
  console.log(`    -H 'authorization: Bearer super-secret' \\`);
  console.log(`    -H 'x-request-id: demo-1' \\`);
  console.log(
    `    -d '{"title":"otel-kit","body":"hello","userId":1,"apiKey":"leak-me-not"}'\n`,
  );
};

bootstrap().catch(async (error: unknown) => {
  console.error(error);
  // Flush whatever was already recorded before leaving.
  await handle.sdk.shutdown();
  process.exit(1);
});
