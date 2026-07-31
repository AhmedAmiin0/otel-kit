/**
 * Structural stand-in for @opentelemetry/instrumentation's Instrumentation.
 *
 * Core must not depend on that package — only src/node/ may. Declaring the
 * shape here lets core type a user-supplied instrumentation instance without
 * pulling the SDK into the framework-free layer.
 */
export interface Instrumentation {
  instrumentationName: string;
  instrumentationVersion: string;
  enable(): void;
  disable(): void;
}
