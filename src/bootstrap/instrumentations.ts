import type { IncomingMessage } from 'node:http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { TypeormInstrumentation } from '@opentelemetry/instrumentation-typeorm';
import type { ObservabilityConfig } from '../config';
import { isTrue } from '../helpers';

export const createOrmInstrumentations = (config: ObservabilityConfig): Instrumentation[] => {
  const typeorm = config.tracing.typeorm;
  if (!typeorm.enabled) return [];
  return [
    new TypeormInstrumentation({
      enableInternalInstrumentation: true,
      enhancedDatabaseReporting: true,
    }),
  ];
};

export const createInstrumentations = (config: ObservabilityConfig): Instrumentation[] => {
  const ignored = config.tracing.ignoreRoutes;

  return [
    ...getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: isTrue(process.env.OTEL_FS_ENABLED, false),
      },
      '@opentelemetry/instrumentation-router': {
        enabled: isTrue(process.env.OTEL_ROUTER_ENABLED, false),
      },
      '@opentelemetry/instrumentation-express': {
        ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
      },
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req: IncomingMessage) => {
          const url = req.url ?? '';
          return ignored.some((route) => url.startsWith(route));
        },
      },
      '@opentelemetry/instrumentation-nestjs-core': { enabled: true },
      '@opentelemetry/instrumentation-kafkajs': {
        enabled: config.tracing.kafkajs.enabled,
      },
    }),
    ...createOrmInstrumentations(config),
  ];
};
