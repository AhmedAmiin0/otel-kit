import type { Instrumentation } from '../../core/config/instrumentation-shim';
import type { Diagnostics } from '../../core/diagnostics';
import {
  canResolve as defaultCanResolve,
  requireOptional as defaultRequireOptional,
} from '../resolve';
import type { InstrumentationDescriptor } from './types';

export interface ResolverDeps {
  canResolve: (id: string) => boolean;
  requireOptional: (id: string) => unknown;
}

type Ctor = new (config: Record<string, unknown>) => Instrumentation;

const DEFAULT_DEPS: ResolverDeps = {
  canResolve: defaultCanResolve,
  requireOptional: defaultRequireOptional,
};

const pickConstructor = (mod: unknown, name?: string): Ctor | undefined => {
  if (typeof mod !== 'object' || mod === null) return undefined;

  const bag = mod as Record<string, unknown>;
  const candidate = name
    ? bag[name]
    : (bag['default'] ?? Object.values(bag).find((v) => typeof v === 'function'));

  return typeof candidate === 'function' ? (candidate as Ctor) : undefined;
};

/**
 * Selects instrumentations at runtime from what the application actually has.
 *
 * Two independent gates: the library being instrumented must be present, and
 * the instrumentation package itself must be installed. Neither ever throws —
 * a missing instrumentation costs detail, and must not stop the application.
 * Exporters take the opposite policy, because a missing exporter means no
 * telemetry reaches anything at all.
 */
export const resolveInstrumentations = (
  descriptors: InstrumentationDescriptor[],
  diag: Diagnostics,
  deps: ResolverDeps = DEFAULT_DEPS,
): Instrumentation[] => {
  const out: Instrumentation[] = [];

  for (const d of descriptors) {
    if (d.enabled === false) continue;

    // A stated intent that cannot be honored is loud; a default that simply
    // does not apply here is quiet.
    const level = d.explicit ? 'warn' : 'debug';

    // Gate 1 — is the library this instruments actually in the app?
    if (d.requires && !deps.canResolve(d.requires)) {
      diag.log(level, `skip ${d.name}: ${d.requires} is not installed`);
      continue;
    }

    // Gate 2 — is the instrumentation package itself installed?
    if (!deps.canResolve(d.module)) {
      diag.log(level, `skip ${d.name}: install ${d.module} to enable it`);
      continue;
    }

    const Ctor = pickConstructor(deps.requireOptional(d.module), d.export);
    if (!Ctor) {
      diag.warn(`skip ${d.name}: ${d.module} exports no usable constructor`);
      continue;
    }

    try {
      out.push(new Ctor(d.config ?? {}));
      diag.debug(`enabled ${d.name} via ${d.module}`);
    } catch (err) {
      diag.warn(`skip ${d.name}: ${d.module} failed to construct (${(err as Error).message})`);
    }
  }

  return out;
};
