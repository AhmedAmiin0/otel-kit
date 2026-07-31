/**
 * Structural stand-in for @opentelemetry/instrumentation's Instrumentation.
 * Declared here so core does not depend on that package; only src/node does.
 */
export interface Instrumentation {
  instrumentationName: string;
  instrumentationVersion: string;
  enable(): void;
  disable(): void;
}
