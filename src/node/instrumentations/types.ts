import type { Instrumentation } from '../../core/config/instrumentation-shim';

export interface InstrumentationDescriptor {
  /** Stable key used for overrides and the env allow/deny lists, e.g. 'typeorm'. */
  name: string;
  /** Package to load, e.g. '@opentelemetry/instrumentation-typeorm'. */
  module: string;
  /** Named export to construct. Falls back to default, then the first constructor. */
  export?: string;
  /** The library being instrumented, e.g. 'typeorm'. Absent means always applicable. */
  requires?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  /**
   * Set by the merge step, never by consumers: true when this descriptor was
   * named in user config or OTEL_INSTRUMENTATIONS. Decides whether an
   * unavailable package is logged at warn (stated intent) or debug (default).
   */
  explicit?: boolean;
}

export type InstrumentationEntry =
  | boolean
  | Partial<InstrumentationDescriptor>
  | Instrumentation;
