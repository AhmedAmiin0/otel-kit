import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const PORT = Number(process.env.PORT ?? 3000);

const bootstrap = async (): Promise<void> => {
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
