import type { Diagnostics } from '../../core/diagnostics';
import {
  canResolve as defaultCanResolve,
  requireOptional as defaultRequireOptional,
} from '../resolve';
import {
  LOG_EXPORTERS,
  TRACE_EXPORTERS,
  type ExporterModuleTable,
  type ExporterOptions,
} from './types';

export interface ExporterDeps {
  canResolve: (id: string) => boolean;
  requireOptional: (id: string) => unknown;
}

const DEFAULT_DEPS: ExporterDeps = {
  canResolve: defaultCanResolve,
  requireOptional: defaultRequireOptional,
};

const build = (
  table: ExporterModuleTable,
  name: string,
  options: ExporterOptions,
  deps: ExporterDeps,
): unknown => {
  const entry = (table as Record<string, [string, string] | undefined>)[name];

  if (!entry) {
    throw new Error(
      `[observability] unknown exporter "${name}". ` +
        `Valid names: ${Object.keys(table).join(', ')}, none`,
    );
  }

  const [module, exportName] = entry;

  // Unlike a missing instrumentation, a missing exporter means no telemetry
  // reaches anything — failing loudly is the only safe behavior.
  if (!deps.canResolve(module)) {
    throw new Error(
      `[observability] exporter "${name}" requires ${module}, which is not installed. ` +
        `Run \`npm install ${module}\`, or set the exporter to "console" or "none".`,
    );
  }

  const bag = deps.requireOptional(module) as Record<string, unknown> | undefined;
  const Ctor = bag?.[exportName];

  if (typeof Ctor !== 'function') {
    throw new TypeError(`[observability] ${module} does not export ${exportName}`);
  }

  // ConsoleSpanExporter takes no options; an empty object is harmless.
  const opts = options.endpoint ? { url: options.endpoint } : {};
  return new (Ctor as new (o: unknown) => unknown)(opts);
};

const resolveWith = (
  table: ExporterModuleTable,
  spec: unknown,
  options: ExporterOptions,
  diag: Diagnostics,
  deps: ExporterDeps,
): unknown[] => {
  if (Array.isArray(spec)) {
    return spec.flatMap((entry) => resolveWith(table, entry, options, diag, deps));
  }

  if (spec === 'none' || spec === undefined) return [];

  if (typeof spec === 'string') {
    const made = build(table, spec, options, deps);
    diag.debug(`exporter ${spec} ready`);
    return [made];
  }

  if (typeof spec === 'function') return [(spec as () => unknown)()];
  if (typeof spec === 'object' && spec !== null) return [spec];

  throw new Error(`[observability] unsupported exporter specification: ${String(spec)}`);
};

export const resolveTraceExporters = (
  spec: unknown,
  options: ExporterOptions,
  diag: Diagnostics,
  deps: ExporterDeps = DEFAULT_DEPS,
): unknown[] => resolveWith(TRACE_EXPORTERS, spec, options, diag, deps);

export const resolveLogExporters = (
  spec: unknown,
  options: ExporterOptions,
  diag: Diagnostics,
  deps: ExporterDeps = DEFAULT_DEPS,
): unknown[] => resolveWith(LOG_EXPORTERS, spec, options, diag, deps);
