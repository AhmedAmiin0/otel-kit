/**
 * Only plain objects may recurse. A user-supplied SpanExporter or
 * Instrumentation instance would be destroyed by a field-by-field merge.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;

  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const mergeTwo = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;

    const existing = out[key];
    out[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? mergeTwo(existing, value)
        : value;
  }

  return out;
};

export const deepMerge = <T>(base: T, ...overrides: unknown[]): T =>
  overrides.reduce<Record<string, unknown>>(
    (acc, override) => (isPlainObject(override) ? mergeTwo(acc, override) : acc),
    { ...(base as Record<string, unknown>) },
  ) as T;
