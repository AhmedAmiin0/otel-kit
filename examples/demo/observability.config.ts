import type { ObservabilityConfigInput } from 'otel-kit/core';

/**
 * Defined once and shared by the preload and the Nest module, so the service
 * name, exporters and redaction rules cannot drift apart.
 */
export const observability: ObservabilityConfigInput = {
  service: { name: 'otel-kit-demo', version: '0.1.0' },
  // Console keeps the demo runnable with no collector listening.
  traces: { exporter: 'console' },
  metrics: { exporter: 'none' },
  logs: { exporter: 'none' },
  // Shows which instrumentations were found and which were skipped.
  diagnostics: { level: 'debug' },
};
