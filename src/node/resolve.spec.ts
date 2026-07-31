import { join } from 'node:path';
import { resolutionPaths, canResolve, requireOptional } from './resolve';

/** Stands in for "a dependency the consuming app has but the library does not". */
const APP = join(__dirname, '..', '..', 'test', 'fixtures', 'app');

describe('resolutionPaths', () => {
  it('includes the current working directory', () => {
    expect(resolutionPaths()).toContain(process.cwd());
  });

  it('returns no duplicates', () => {
    const paths = resolutionPaths();
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('canResolve', () => {
  it('finds a package that exists only under the supplied path', () => {
    expect(canResolve('fixture-lib', [APP])).toBe(true);
  });

  // Regression guard: fails if the implementation is ever "simplified" back to
  // a bare require.resolve(id), which searches the library's own node_modules
  // and would never see a pnpm consumer's dependencies.
  it('does not find that package from the library location', () => {
    expect(canResolve('fixture-lib', [__dirname])).toBe(false);
  });

  it('returns false for a package that exists nowhere', () => {
    expect(canResolve('definitely-not-installed-xyz', [APP])).toBe(false);
  });

  it('finds a real installed dependency with default paths', () => {
    expect(canResolve('@opentelemetry/api')).toBe(true);
  });
});

describe('requireOptional', () => {
  it('loads the module when resolvable', () => {
    expect(requireOptional<{ marker: string }>('fixture-lib', [APP])?.marker).toBe('fixture-lib');
  });

  it('returns undefined instead of throwing when missing', () => {
    expect(requireOptional('definitely-not-installed-xyz', [APP])).toBeUndefined();
  });
});
