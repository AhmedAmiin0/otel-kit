import { deepMerge } from './merge';
import { defaults } from './defaults';
import { fromEnv } from './env';
import type { ObservabilityConfig, ObservabilityConfigInput } from './types';

/**
 * Converts input-shaped values to resolved-shaped ones.
 *
 * Must run before the merge: a Set is not a plain object, so deepMerge
 * replaces it wholesale rather than merging it. Normalizing afterwards would
 * mean merging a string[] over a Set.
 */
const normalize = (input: ObservabilityConfigInput): Record<string, unknown> => {
  const out = { ...input } as Record<string, unknown>;
  const redaction = out['redaction'] as { keys?: string[] } | undefined;

  if (redaction?.keys !== undefined) {
    out['redaction'] = {
      ...redaction,
      keys: new Set(redaction.keys.map((key) => key.toLowerCase())),
    };
  }

  return out;
};

/**
 * Resolves the effective configuration.
 *
 * Precedence falls out of argument order: defaults, then environment, then
 * programmatic overrides. `env` is a parameter so precedence can be tested
 * without mutating the real process environment.
 */
export const defineConfig = (
  overrides: ObservabilityConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): ObservabilityConfig =>
  deepMerge(defaults(env), normalize(fromEnv(env)), normalize(overrides));
