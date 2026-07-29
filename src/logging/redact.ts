import type { ObservabilityConfig } from '../config';

type Redaction = ObservabilityConfig['redaction'];

export const redactBody = (
  value: unknown,
  redaction: Redaction,
  depth = 0,
): unknown => {
  if (depth > redaction.maxDepth) return '[MaxDepth]';
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((entry) => redactBody(entry, redaction, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redaction.keys.has(key.toLowerCase())
      ? redaction.placeholder
      : redactBody(entry, redaction, depth + 1);
  }
  return out;
};

export const serializeBody = (
  value: unknown,
  maxChars: number,
): string | undefined => {
  if (value === undefined) return undefined;

  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '[Unserializable]';
  }

  return text.length > maxChars
    ? `${text.slice(0, maxChars)}... max ${maxChars} chars`
    : text;
};

export const redactAndSerialize = (
  value: unknown,
  redaction: Redaction,
): string | undefined =>
  serializeBody(redactBody(value, redaction), redaction.bodyMaxChars);
