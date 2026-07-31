import type { ObsLogger } from '../core/logger/types';

/** The part of winston's Logger this needs; avoids a value import of winston. */
export interface WinstonLike {
  log(level: string, message: string, meta?: object): unknown;
  child(bindings: object): WinstonLike;
}

/**
 * Adapts a winston logger to ObsLogger.
 *
 * The argument order swaps: winston takes (message, meta), ObsLogger takes
 * (obj, msg). Levels line up with winston's npm levels, which are the default.
 */
export const createWinstonLogger = (winston: WinstonLike): ObsLogger => {
  const write =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (obj: object | string, msg?: string): void => {
      if (typeof obj === 'string') winston.log(level, obj);
      else winston.log(level, msg ?? '', obj);
    };

  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (bindings) => createWinstonLogger(winston.child(bindings)),
  };
};
