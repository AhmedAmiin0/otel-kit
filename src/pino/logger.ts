import type { ObsLogger } from '../core/logger/types';
import type { ObservabilityConfig } from '../core/config/types';

/**
 * Adapts a pino instance to the ObsLogger interface.
 *
 * pino is loaded here rather than imported at module scope so that importing
 * this subpath is the only thing that pulls pino in.
 */
export const createPinoLogger = (config: ObservabilityConfig): ObsLogger => {
  const pino = require('pino') as typeof import('pino').pino;

  const instance = pino({ level: config.logging.level });

  const wrap = (logger: import('pino').Logger): ObsLogger => ({
    debug: (obj, msg) => logger.debug(obj as object, msg),
    info: (obj, msg) => logger.info(obj as object, msg),
    warn: (obj, msg) => logger.warn(obj as object, msg),
    error: (obj, msg) => logger.error(obj as object, msg),
    child: (bindings) => wrap(logger.child(bindings)),
  });

  return wrap(instance);
};
