/** A plain symbol rather than registerAs(...).KEY, so this does not require @nestjs/config. */
export const OBSERVABILITY_CONFIG = Symbol.for('observability:config');
