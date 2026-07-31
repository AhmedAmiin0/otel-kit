import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { createDiagnostics } from '../core/diagnostics';
import { defineConfig } from '../core/config/define-config';
import { setTelemetryConfig } from '../core/telemetry/handles';
import type { ObservabilityConfig, ObservabilityConfigInput } from '../core/config/types';
import { defaultCatalog } from './instrumentations/catalog';
import { mergeInstrumentations } from './instrumentations/merge';
import { resolveInstrumentations } from './instrumentations/resolve';
import { resolveTraceExporters, resolveLogExporters, type ExporterDeps } from './exporters/signals';
import { resolveMetricReaders } from './exporters/metrics';
import { registerShutdownHooks } from './shutdown';
import { canResolve, requireOptional } from './resolve';

const DEFAULT_DEPS: ExporterDeps = { canResolve, requireOptional };

export interface BuiltSdk {
  sdk: NodeSDK;
  instrumentations: unknown[];
  traceExporters: unknown[];
  metricReaders: unknown[];
  logExporters: unknown[];
  resourceAttributes: Record<string, string>;
}

/** Returns the resolved parts alongside the SDK so a pipeline can be asserted unstarted. */
export const createSdk = (
  config: ObservabilityConfig,
  deps: ExporterDeps = DEFAULT_DEPS,
): BuiltSdk => {
  const diag = createDiagnostics(config.diagnostics.level);

  const { descriptors, instances } = mergeInstrumentations(
    defaultCatalog(config),
    config.instrumentations,
  );
  const instrumentations = [...resolveInstrumentations(descriptors, diag, deps), ...instances];

  // Resolved before construction so a bad spec throws instead of half-configuring.
  const traceExporters = resolveTraceExporters(
    config.traces.exporter,
    { endpoint: config.traces.endpoint },
    diag,
    deps,
  );

  if (traceExporters.length > 1) {
    // NodeSDK takes one traceExporter; fanning out needs custom span processors.
    diag.warn(`${traceExporters.length} trace exporters configured; only the first is wired`);
  }

  const metricReaders = resolveMetricReaders(
    config.metrics.exporter,
    {
      endpoint: config.metrics.endpoint,
      exportIntervalMs: config.metrics.exportIntervalMs,
      port: config.metrics.port,
    },
    diag,
    deps,
  );

  const logExporters = resolveLogExporters(
    config.logs.exporter,
    { endpoint: config.logs.endpoint },
    diag,
    deps,
  );

  const resourceAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: config.service.name,
    [ATTR_SERVICE_VERSION]: config.service.version,
    ...config.resource.attributes,
  };

  const sdk = new NodeSDK({
    resource: resourceFromAttributes(resourceAttributes),
    ...(traceExporters.length > 0 ? { traceExporter: traceExporters[0] as never } : {}),
    ...(metricReaders.length > 0 ? { metricReaders: metricReaders as never[] } : {}),
    ...(logExporters.length > 0
      ? { logRecordProcessors: logExporters.map((e) => new BatchLogRecordProcessor(e as never)) }
      : {}),
    instrumentations: instrumentations as never[],
  });

  return { sdk, instrumentations, traceExporters, metricReaders, logExporters, resourceAttributes };
};

let started: BuiltSdk | undefined;

export interface SdkHandle extends BuiltSdk {
  unregisterShutdownHooks: () => void;
}

/** Resets the double-bootstrap guard. Test seam only. */
export const resetObservability = (): void => {
  started = undefined;
};

export const startObservability = (input: ObservabilityConfigInput = {}): SdkHandle => {
  const config = defineConfig(input);
  const diag = createDiagnostics(config.diagnostics.level);

  if (started) {
    // Starting twice would patch every instrumented module a second time.
    diag.warn('observability is already started; ignoring the second call');
    return { ...started, unregisterShutdownHooks: () => undefined };
  }

  setTelemetryConfig(config);
  const built = createSdk(config);
  built.sdk.start();
  started = built;

  diag.info(`observability started for ${config.service.name}`);
  return { ...built, unregisterShutdownHooks: registerShutdownHooks(built.sdk, diag) };
};
