import type { ObsLogger } from './types';

export type Level = 'debug' | 'info' | 'warn' | 'error';

/** winston, log4js, tslog, consola: the message comes first. */
export type MessageFirstLogger = Record<Level, (message: string, meta?: object) => unknown>;

/** bunyan and pino: the object comes first, exactly like ObsLogger. */
export type ObjectFirstLogger = Record<Level, (obj: object | string, msg?: string) => unknown> & {
  child?: (bindings: object) => ObjectFirstLogger;
};

const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];

const build = (write: (level: Level) => ObsLogger[Level], child: ObsLogger['child']): ObsLogger =>
  ({
    ...(Object.fromEntries(LEVELS.map((level) => [level, write(level)])) as Record<
      Level,
      ObsLogger[Level]
    >),
    child,
  }) as ObsLogger;

/**
 * Adapts a logger whose methods take (message, meta).
 *
 * Bindings are merged in here rather than delegated to the target's own child,
 * so this works for loggers that have no child concept at all — log4js, for one.
 */
export const fromMessageFirst = (
  target: MessageFirstLogger,
  bindings: object = {},
): ObsLogger => {
  const write =
    (level: Level) =>
    (obj: object | string, msg?: string): void => {
      const isText = typeof obj === 'string';
      const meta = isText ? bindings : { ...bindings, ...obj };
      target[level](isText ? obj : (msg ?? ''), meta);
    };

  return build(write, (extra) => fromMessageFirst(target, { ...bindings, ...extra }));
};

/**
 * Adapts a logger that already takes (obj, msg) — bunyan, or pino directly.
 *
 * Uses the target's own child when it has one, so its native binding
 * behaviour is preserved.
 */
export const fromObjectFirst = (
  target: ObjectFirstLogger,
  bindings: object = {},
): ObsLogger => {
  const write =
    (level: Level) =>
    (obj: object | string, msg?: string): void => {
      if (typeof obj === 'string') target[level]({ ...bindings }, obj);
      else target[level]({ ...bindings, ...obj }, msg);
    };

  return build(write, (extra) =>
    target.child
      ? fromObjectFirst(target.child(extra), {})
      : fromObjectFirst(target, { ...bindings, ...extra }),
  );
};
