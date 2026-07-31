import type { ObservabilityConfig } from '../config/types';

type Redaction = ObservabilityConfig['redaction'];

const TRUNCATED = '[Truncated]';
const MAX_DEPTH = '[MaxDepth]';

interface Budget {
  remaining: number;
}

/**
 * Bounded deep copy with sensitive values masked.
 *
 * The budget matters: serializeBody truncates the *output*, but without a cap
 * the walk still copies an entire parsed upload before anything is thrown
 * away. Counting visited values bounds the work to the size of what can
 * actually be logged.
 */
const walk = (value: unknown, redaction: Redaction, depth: number, budget: Budget): unknown => {
  if (depth > redaction.maxDepth) return MAX_DEPTH;
  if (value === null || typeof value !== 'object') return value;
  if (budget.remaining <= 0) return TRUNCATED;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const entry of value) {
      if (budget.remaining <= 0) {
        out.push(TRUNCATED);
        break;
      }
      budget.remaining -= 1;
      out.push(walk(entry, redaction, depth + 1, budget));
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (budget.remaining <= 0) {
      out['...'] = TRUNCATED;
      break;
    }
    budget.remaining -= 1;
    out[key] = redaction.keys.has(key.toLowerCase())
      ? redaction.placeholder
      : walk(entry, redaction, depth + 1, budget);
  }
  return out;
};

export const redactBody = (value: unknown, redaction: Redaction, depth = 0): unknown =>
  walk(value, redaction, depth, { remaining: redaction.maxNodes });

export const serializeBody = (value: unknown, maxChars: number): string | undefined => {
  if (value === undefined) return undefined;

  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '[Unserializable]';
  }

  return text.length > maxChars ? `${text.slice(0, maxChars)}... max ${maxChars} chars` : text;
};

export const redactAndSerialize = (value: unknown, redaction: Redaction): string | undefined =>
  serializeBody(redactBody(value, redaction), redaction.bodyMaxChars);
