import { deepMerge } from './merge';
import { defaults } from './defaults';
import { fromEnv } from './env';
import type { ObservabilityConfig, ObservabilityConfigInput } from './types';

/** Must run before the merge: deepMerge replaces a Set wholesale rather than merging it. */
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
 * Precedence follows argument order: defaults, environment, then overrides.
 * `env` is a parameter so precedence is testable without mutating process.env.
 */
export const defineConfig = (
  overrides: ObservabilityConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): ObservabilityConfig =>
  deepMerge(defaults(env), normalize(fromEnv(env)), normalize(overrides));
