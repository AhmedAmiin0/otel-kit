/**
 * DI token for the resolved observability config.
 *
 * A plain symbol rather than `registerAs(...).KEY`, so the Nest adapter does
 * not require @nestjs/config. Consumers who want ConfigService can still
 * build the input with `ObservabilityModule.forRootAsync`.
 */
export const OBSERVABILITY_CONFIG = Symbol.for('observability:config');
