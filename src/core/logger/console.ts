import type { ObsLogger } from './types';

/** Pino's numeric level scale, so levels configured for pino behave the same here. */
const RANK: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
};

const DEFAULT_RANK = RANK['info'] as number;

/** Zero-dependency JSON logger, so core can log without pino installed. */
export const createConsoleLogger = (level = 'info', bindings: object = {}): ObsLogger => {
  const threshold = RANK[level] ?? DEFAULT_RANK;

  const emit = (at: string, obj: object | string, msg?: string): void => {
    if ((RANK[at] ?? 0) < threshold) return;

    const payload =
      typeof obj === 'string' ? { msg: obj } : { ...obj, ...(msg ? { msg } : {}) };

    console.log(JSON.stringify({ level: at, ...bindings, ...payload }));
  };

  return {
    debug: (o, m) => emit('debug', o, m),
    info: (o, m) => emit('info', o, m),
    warn: (o, m) => emit('warn', o, m),
    error: (o, m) => emit('error', o, m),
    child: (extra) => createConsoleLogger(level, { ...bindings, ...extra }),
  };
};
