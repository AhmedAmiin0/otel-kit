import type { Diagnostics } from '../core/diagnostics';

export interface ShutdownTarget {
  shutdown(): Promise<void>;
}

export interface ShutdownOptions {
  /** Injected so tests do not kill the jest worker. */
  exit?: (code: number) => void;
}

const SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Flushes telemetry on termination.
 *
 * Returns an unregister function so callers — tests especially — can remove
 * the listeners again rather than leaking one pair per registration.
 */
export const registerShutdownHooks = (
  sdk: ShutdownTarget,
  diag: Diagnostics,
  options: ShutdownOptions = {},
): (() => void) => {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let started = false;

  const handlers = SIGNALS.map((signal) => {
    const handler = (): void => {
      if (started) return;
      started = true;

      sdk
        .shutdown()
        .then(() => {
          diag.info(`OpenTelemetry SDK shut down (${signal})`);
          exit(0);
        })
        .catch((err: unknown) => {
          // The previous implementation exited 0 here, reporting success to
          // the orchestrator even when the flush had failed.
          diag.error(`error shutting down OpenTelemetry SDK: ${(err as Error).message}`);
          exit(1);
        });
    };

    process.on(signal, handler);
    return [signal, handler] as const;
  });

  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
};
