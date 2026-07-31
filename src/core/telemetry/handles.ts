import { trace, metrics, type Meter, type Tracer } from '@opentelemetry/api';
import { defineConfig } from '../config/define-config';
import type { ObservabilityConfig } from '../config/types';

let config: ObservabilityConfig | undefined;
let cached: { tracer: Tracer; meter: Meter } | undefined;

/** Called by the bootstrap so the tracer carries the resolved service name. */
export const setTelemetryConfig = (next: ObservabilityConfig): void => {
  config = next;
  cached = undefined;
};

/** Test seam — drops the memoized handles so a new provider takes effect. */
export const resetTelemetryHandles = (): void => {
  cached = undefined;
};

/** Resolved on first use, not at import: otherwise import order decides the service name. */
const handles = (): { tracer: Tracer; meter: Meter } => {
  if (cached) return cached;

  const { name, version } = (config ??= defineConfig()).service;
  cached = {
    tracer: trace.getTracer(name, version),
    meter: metrics.getMeter(name, version),
  };
  return cached;
};

export const getTracer = (): Tracer => handles().tracer;

export const getMeter = (): Meter => handles().meter;
