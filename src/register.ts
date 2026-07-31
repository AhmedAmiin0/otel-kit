/**
 * Preload before the application so instrumentation patches modules first:
 *
 *   node -r otel-kit/register dist/main.js
 *
 * Does not load dotenv — a library should not mutate the host's environment.
 * Preload it yourself: `node -r dotenv/config -r otel-kit/register`.
 */
import { startObservability } from './node/sdk';

export const handle = startObservability();
