import { NestFactory } from '@nestjs/core';
import { startObservability } from 'otel-kit/node';
import { AppModule } from './app.module';
import { observability } from './observability.config';

const PORT = Number(process.env.PORT ?? 3000);

const bootstrap = async (): Promise<void> => {
  // Synchronous, and it registers its own shutdown hooks, so there is nothing
  // to await here and nothing to tear down by hand.
  startObservability(observability);

  const app = await NestFactory.create(AppModule);
  await app.listen(PORT);

  console.log(`\ndemo listening on http://localhost:${PORT}\n`);
  console.log('Try:\n');
  console.log(`  curl -X POST http://localhost:${PORT}/posts \\`);
  console.log(`    -H 'content-type: application/json' \\`);
  console.log(`    -H 'authorization: Bearer super-secret' \\`);
  console.log(`    -H 'x-request-id: demo-1' \\`);
  console.log(`    -d '{"title":"otel-kit","body":"hello","userId":1,"apiKey":"leak-me-not"}'\n`);
};

void bootstrap();
