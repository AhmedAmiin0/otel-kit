import type { DiagnosticLevel } from './config/types';

export type EmittableLevel = Exclude<DiagnosticLevel, 'none'>;

export type DiagnosticSink = (level: EmittableLevel, message: string) => void;

export interface Diagnostics {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
  log(level: EmittableLevel, message: string): void;
}

const RANK: Record<DiagnosticLevel, number> = {
  none: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const consoleSink: DiagnosticSink = (level, message) => {
  const line = `[observability] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

/**
 * Level-gated bootstrap logging.
 *
 * Defaults to silent: a library must not write to stdout unbidden. The old
 * bootstrap logged to console.log unconditionally (src/bootstrap/shutdown.ts).
 */
export const createDiagnostics = (
  level: DiagnosticLevel,
  sink: DiagnosticSink = consoleSink,
): Diagnostics => {
  const threshold = RANK[level];

  const log = (at: EmittableLevel, message: string): void => {
    if (threshold === 0 || RANK[at] > threshold) return;
    sink(at, message);
  };

  return {
    log,
    error: (m) => log('error', m),
    warn: (m) => log('warn', m),
    info: (m) => log('info', m),
    debug: (m) => log('debug', m),
  };
};
