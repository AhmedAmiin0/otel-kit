/**
 * Side-effect entry point. Preload before the application so instrumentation
 * patches modules before they are required:
 *
 *   node -r @yourscope/observability/register dist/main.js
 *
 * Deliberately does NOT load dotenv — a library must not mutate the host's
 * environment. If you need a .env file, preload it yourself:
 *
 *   node -r dotenv/config -r @yourscope/observability/register dist/main.js
 */
import { startObservability } from './node/sdk';

export const handle = startObservability();
