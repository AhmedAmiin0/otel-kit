import type { NodeSDK } from '@opentelemetry/sdk-node';

export const registerShutdownHooks = (sdk: NodeSDK): void => {
  const shutdown = (signal: string): void => {
    sdk
      .shutdown()
      .then(() => console.log(`OpenTelemetry SDK shut down (${signal})`))
      .catch((err) =>
        console.error('Error shutting down OpenTelemetry SDK', err),
      )
      .finally(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};
