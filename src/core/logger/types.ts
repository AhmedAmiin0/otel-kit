/** Pino-shaped so its binding is thin, small enough that any logger can satisfy it. */
export interface ObsLogger {
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  child(bindings: object): ObsLogger;
}
