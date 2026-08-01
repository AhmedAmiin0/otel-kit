/** A plain symbol rather than registerAs(...).KEY, so this does not require @nestjs/config. */
export const OBSERVABILITY_CONFIG = Symbol.for('observability:config');

/** The ObsLogger request logging writes to, when one was supplied. */
export const OBSERVABILITY_LOGGER = Symbol.for('observability:logger');
