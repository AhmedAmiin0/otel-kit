import type { ObservabilityConfig } from '../../core/config/types';
import type { InstrumentationDescriptor } from './types';

const ignoreBy =
  (routes: string[]) =>
  (req: { url?: string }): boolean => {
    const url = req.url ?? '';
    return routes.some((route) => url.startsWith(route));
  };

/**
 * The built-in instrumentations, described as data.
 *
 * Nothing here imports an instrumentation package — a descriptor names its
 * module as a string, so describing the catalog costs nothing. The old
 * bootstrap imported TypeormInstrumentation and ExpressLayerType at module
 * scope and only then checked whether they were enabled, which meant the
 * packages had to be installed either way.
 */
export const defaultCatalog = (cfg: ObservabilityConfig): InstrumentationDescriptor[] => [
  {
    name: 'http',
    module: '@opentelemetry/instrumentation-http',
    config: { ignoreIncomingRequestHook: ignoreBy(cfg.traces.ignoreRoutes) },
  },
  {
    name: 'express',
    module: '@opentelemetry/instrumentation-express',
    requires: 'express',
    // String literal rather than the ExpressLayerType enum, so describing this
    // does not require importing the package it describes.
    config: { ignoreLayersType: ['middleware'] },
  },
  {
    name: 'nestjs',
    module: '@opentelemetry/instrumentation-nestjs-core',
    requires: '@nestjs/core',
  },
  {
    name: 'kafkajs',
    module: '@opentelemetry/instrumentation-kafkajs',
    requires: 'kafkajs',
  },
  {
    name: 'typeorm',
    module: '@opentelemetry/instrumentation-typeorm',
    requires: 'typeorm',
    config: { enableInternalInstrumentation: true, enhancedDatabaseReporting: true },
  },
  { name: 'pg', module: '@opentelemetry/instrumentation-pg', requires: 'pg' },
  { name: 'ioredis', module: '@opentelemetry/instrumentation-ioredis', requires: 'ioredis' },
  { name: 'mongodb', module: '@opentelemetry/instrumentation-mongodb', requires: 'mongodb' },
  { name: 'graphql', module: '@opentelemetry/instrumentation-graphql', requires: 'graphql' },
  // Noisy enough that it is off unless asked for.
  { name: 'fs', module: '@opentelemetry/instrumentation-fs', enabled: false },
];
