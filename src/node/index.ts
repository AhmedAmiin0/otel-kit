export { createSdk, startObservability, resetObservability } from './sdk';
export type { BuiltSdk, SdkHandle } from './sdk';

export { registerShutdownHooks } from './shutdown';
export type { ShutdownTarget, ShutdownOptions } from './shutdown';

export { resolutionPaths, canResolve, requireOptional } from './resolve';

export { defaultCatalog } from './instrumentations/catalog';
export { mergeInstrumentations } from './instrumentations/merge';
export { resolveInstrumentations } from './instrumentations/resolve';
export type { ResolverDeps } from './instrumentations/resolve';
export type { InstrumentationDescriptor, InstrumentationEntry } from './instrumentations/types';

export { resolveTraceExporters, resolveLogExporters } from './exporters/signals';
export type { ExporterDeps } from './exporters/signals';
export { resolveMetricReaders } from './exporters/metrics';
export type { MetricOptions } from './exporters/metrics';
export type {
  NamedExporter,
  NamedMetricExporter,
  ExporterSpec,
  ExporterOptions,
} from './exporters/types';
