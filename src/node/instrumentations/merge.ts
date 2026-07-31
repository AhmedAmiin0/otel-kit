import { deepMerge } from '../../core/config/merge';
import type { Instrumentation } from '../../core/config/instrumentation-shim';
import type { InstrumentationDescriptor } from './types';

const isInstance = (value: unknown): value is Instrumentation =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Instrumentation).enable === 'function' &&
  typeof (value as Instrumentation).disable === 'function';

/**
 * Folds user overrides into the catalog, keyed by name.
 *
 * Live Instrumentation instances are separated out here so the resolver only
 * ever deals with descriptors.
 */
export const mergeInstrumentations = (
  catalog: InstrumentationDescriptor[],
  overrides: Record<string, unknown>,
): { descriptors: InstrumentationDescriptor[]; instances: Instrumentation[] } => {
  const byName = new Map(catalog.map((d) => [d.name, { ...d }]));
  const instances: Instrumentation[] = [];

  for (const [name, override] of Object.entries(overrides)) {
    if (isInstance(override)) {
      instances.push(override);
      continue;
    }

    if (typeof override === 'boolean') {
      const existing = byName.get(name);
      if (existing) byName.set(name, { ...existing, enabled: override, explicit: true });
      continue;
    }

    if (typeof override !== 'object' || override === null) continue;

    const patch = override as Partial<InstrumentationDescriptor>;
    const existing = byName.get(name);

    if (existing) {
      // `name` is re-pinned last so a patch cannot rename an entry out from
      // under the key it is stored by.
      byName.set(name, { ...deepMerge(existing, patch), name, explicit: true });
      continue;
    }

    // A new descriptor must name a module; there is nothing to load otherwise.
    if (typeof patch.module !== 'string') continue;
    byName.set(name, { ...patch, name, module: patch.module, explicit: true });
  }

  return { descriptors: [...byName.values()], instances };
};
