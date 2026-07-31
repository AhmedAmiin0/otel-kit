/**
 * require.resolve from inside this file searches the library's own
 * node_modules. Under pnpm's non-hoisted layout that never sees the consuming
 * app's dependencies, so every gate would report "not installed" for packages
 * the app plainly depends on. Search from the app's perspective too.
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
