import { registerAs } from '@nestjs/config';
import { defineConfig } from './core/config/define-config';

export const OBSERVABILITY_NAMESPACE = 'observability';

/** @deprecated Use `defineConfig` from the core entry point. */
export const loadObservabilityConfig = defineConfig;

export const observabilityConfig = registerAs(OBSERVABILITY_NAMESPACE, () => defineConfig());

export type { ObservabilityConfig } from './core/config/types';

export default defineConfig();
