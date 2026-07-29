require('dotenv').config();
import { loadObservabilityConfig } from './config';
import { createSdk } from './bootstrap/sdk';
import { registerShutdownHooks } from './bootstrap/shutdown';

const sdk = createSdk(loadObservabilityConfig());

sdk.start();
registerShutdownHooks(sdk);

export { sdk };
