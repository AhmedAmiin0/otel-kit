export const isTrue = (
  value: string | undefined,
  fallback: boolean,
): boolean =>
  value === undefined ? fallback : /^(1|true|yes|on)$/i.test(value.trim());

export const commaStringToList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const commaStringToLowerSet = (value: string): Set<string> =>
  new Set(commaStringToList(value).map((entry) => entry.toLowerCase()));

export const intFromEnv = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};
