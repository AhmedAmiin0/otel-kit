/**
 * Optional-peer resolution.
 *
 * `require.resolve(id)` called from inside this library searches relative to
 * THIS file. Under pnpm's strict, non-hoisted node_modules layout the
 * consuming application's dependencies are not reachable that way, so every
 * lookup must also search from the application's perspective. Without this,
 * an instrumentation gate would report "not installed" for a package the app
 * plainly depends on.
 */
export const resolutionPaths = (): string[] => {
  const candidates = [process.cwd(), ...(require.main?.paths ?? []), __dirname];
  return [...new Set(candidates)];
};

export const canResolve = (id: string, paths: string[] = resolutionPaths()): boolean => {
  try {
    require.resolve(id, { paths });
    return true;
  } catch {
    return false;
  }
};

export const requireOptional = <T>(
  id: string,
  paths: string[] = resolutionPaths(),
): T | undefined => {
  try {
    return require(require.resolve(id, { paths })) as T;
  } catch {
    return undefined;
  }
};
