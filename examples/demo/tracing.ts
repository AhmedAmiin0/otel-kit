/**
 * Preloaded ahead of the application:
 *
 *   node -r ./out/tracing.js ./out/main.js
 *
 * Instrumentation patches modules as they are required, so this has to run
 * before anything imports http, express or Nest. A preload file is how that is
 * guaranteed; calling it from main.ts would not be, because static imports are
 * hoisted above any statement in the file.
 *
 * `node -r otel-kit/register` is the same idea with configuration read from the
 * environment instead of written here.
 */
import { startObservability } from 'otel-kit/node';
import { observability } from './observability.config';

startObservability(observability);
