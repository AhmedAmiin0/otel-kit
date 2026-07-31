/**
 * The logging surface this package depends on.
 *
 * Deliberately small and pino-shaped so a pino binding is a thin adapter,
 * while console, winston, or an OTel log bridge remain equally satisfiable.
 * Keeping it here is what lets pino leave the required dependency tree.
 */
export interface ObsLogger {
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  child(bindings: object): ObsLogger;
}
