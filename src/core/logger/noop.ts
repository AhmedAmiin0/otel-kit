import type { ObsLogger } from './types';

const noop = (): void => undefined;

/** Default when logging is disabled — every call is a no-op. */
export const noopLogger: ObsLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => noopLogger,
};
