# Decoupling `@libs/observability` for public npm release

**Date:** 2026-07-31
**Status:** Approved design, not yet implemented

## Context

`@libs/observability` was written for a private Nx monorepo of NestJS microservices. It is
distributed today by pinning a git tag with a pnpm-only `path:` fragment against an internal
Bitbucket host, against a branch that carries a prebuilt `dist`.

The goal is to publish it to the public npm registry. Before that can happen the package has to stop
assuming its consumer is a NestJS service that logs with pino and exports to an OpenTelemetry
Collector, because on the public registry that consumer is the exception rather than the rule.

## Problems in the current package

Each item below is a concrete blocker for public release, not a style preference.

### P1. Every dependency is mandatory

`package.json` lists `@opentelemetry/auto-instrumentations-node`, four individual instrumentation
packages, three OTLP exporters, `nestjs-pino`, `pino`, `pino-http`, and `dotenv` under
`dependencies`. `auto-instrumentations-node` transitively pulls instrumentation for mongodb, redis,
mysql, pg, aws-sdk, grpc, undici and more. A consumer who wants HTTP traces on a Fastify service
installs all of it.

### P2. Instrumentations are statically imported, then conditionally enabled

`src/bootstrap/instrumentations.ts:4-5` imports `TypeormInstrumentation` and `ExpressLayerType` at
module scope. The `typeorm.enabled` check at line 11 runs after those modules are already required,
so the flag controls only whether a span is produced — it cannot avoid the dependency. Disabling
TypeORM tracing still requires TypeORM instrumentation to be installed.

### P3. Config is a frozen module-level snapshot with a broken override path

`src/config.ts:4` captures `process.env` into a module const and `src/config.ts:11` evaluates the
whole config object at import time. `loadObservabilityConfig` at `src/config.ts:51` merges overrides
with a shallow spread, so passing `{ logging: { level: 'debug' } }` discards every other key under
`logging`. `ObservabilityModule.forRoot({ global: true })` spreads `global` directly into the config
object where it has no meaning. In practice environment variables are the only working configuration
interface.

The exported type is `typeof config`, which leaks internal representations — notably
`redaction.keys: Set<string>` — into the public `.d.ts`, making the type awkward to satisfy by hand.

### P4. `@nestjs/config` is structural

`src/config.ts:56` wraps the config in `registerAs`, and `RequestBodyInterceptor`,
`RequestExceptionFilter`, and `HttpClientLogger` all inject `observabilityConfig.KEY`. Nothing above
the pure helpers can be used without Nest's `ConfigModule`. `HttpClientLogger` additionally imports
`@nestjs/axios` at module scope, so axios is required even when HTTP client logging is off.

### P5. Tracer and meter are created at import time

`src/tracing/tracer.ts:10-14` destructures the service name from `loadObservabilityConfig()` and
creates the tracer and meter as module singletons. Import order therefore decides the service name.

Separately, `getRequestContext` at `src/tracing/tracer.ts:38` falls back to
`tracer.startSpan(name)` when no span is active and never ends that span. Every call without an
active context leaks a span.

### P6. Exporters are hardwired to OTLP over HTTP

`src/bootstrap/sdk.ts` constructs `new OTLPTraceExporter()`, `new OTLPMetricExporter()`, and
`new OTLPLogExporter()` with no configuration and no alternatives. There is no way to select gRPC,
scrape metrics with Prometheus, print to console, supply a vendor exporter, or disable a signal.
With no collector listening, the SDK retries indefinitely and produces no useful signal that
anything is wrong.

### P7. The root barrel pulls in the whole framework

`src/index.ts` exports `ObservabilityModule` alongside `withSpan` and the pure redaction helpers, so
`import { withSpan } from '@libs/observability'` loads `nestjs-pino`, `@nestjs/axios`, and
`@nestjs/core`.

### P8. Release and test gaps

The package contains no test files at all. The README documents a `release.ps1` script that is not
present in the repository. `src/bootstrap.ts` calls `require('dotenv').config()`, mutating the host
application's environment — acceptable in a first-party monorepo, not in a published library. That
call happens to run before `./config` is imported in the current CommonJS emit (verified), but the
ordering is incidental: under an ESM emit, hoisted `import` statements would evaluate `./config`
first and the `.env` file would silently stop applying.

## Goals

1. Core functionality usable from plain Node, Express, or Fastify, with no NestJS in the dependency
   tree.
2. Instrumentations selected at runtime based on what the consuming application actually has
   installed, with per-instrumentation override, disable, and extension.
3. Exporters selectable per signal, including console, Prometheus pull, OTLP over gRPC, and
   arbitrary consumer-supplied exporter instances.
4. Logging pluggable behind a small interface, with pino available as an optional binding.
5. Installing the package with zero optional peers present produces a working, console-exporting
   telemetry setup rather than an error.

## Non-goals

- ESM output. OpenTelemetry's instrumentation relies on CommonJS module patching; ESM support needs
  a `--import` loader hook and is deferred.
- Browser support.
- Replacing the OTel SDK with a custom implementation. This package remains a configuration and
  convenience layer over `@opentelemetry/sdk-node`.
- Vendor-specific exporter packages shipped in-tree. Vendors are supported via the bring-your-own
  exporter hook.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework scope | Framework-agnostic core, NestJS as an optional subpath export | Widest audience without abandoning the existing Nest consumers |
| Logging | Pluggable `ObsLogger` interface, pino binding under `./pino` | Removes `pino`, `pino-http`, `nestjs-pino` from the required tree |
| Exporters | `console`, `prometheus`, `otlp-http`, `otlp-grpc`, `otlp-proto`, `none`, plus BYO instance or factory | Covers dev, pull-based metrics, and vendor backends |
| Config precedence | programmatic override > environment variable > default | Explicit code should beat ambient environment; matches OTel SDK convention |
| Missing-dependency log level | `warn` when explicitly enabled, `debug` when merely defaulted | Silence for auto-detection, loud for a stated intent that cannot be honored |
| Nest and `@nestjs/config` | Config passed through a plain `OBSERVABILITY_CONFIG` token; `forRootAsync` available for `ConfigService` users | Removes `@nestjs/config` from required peers |
| Module format | CommonJS only for v1 | OTel patching is CJS-centric; see non-goals |

## Architecture

### Entry points

```
@yourscope/observability
├─ "."          core     config, redaction, serializers, telemetry facade
├─ "./node"     node     NodeSDK bootstrap, instrumentation resolver, exporter registry
├─ "./nestjs"   nest     module, interceptor, exception filter, HTTP client logger
├─ "./pino"     pino     pino / pino-http binding for ObsLogger
└─ "./register" preload  side-effect entry for `node -r @yourscope/observability/register`
```

### Dependency policy

- **`dependencies`:** `@opentelemetry/api` only. It is the one package that must be a singleton and
  is safe to hard-depend on.
- **`peerDependencies` + `peerDependenciesMeta.optional`:** everything else — SDK packages,
  exporters, instrumentations, pino, Nest packages, axios.
- **Nothing is imported at module scope from an optional peer.** Optional peers are reached only
  through the resolver described below, from inside a function body.

The `./register` entry is the exception: it is a side-effect module and may require `./node`
eagerly, because a consumer who preloads it has opted in.

### Dependency resolution under pnpm

`require.resolve(id)` called from inside the library resolves relative to the library's own
location. Under pnpm's strict, non-hoisted `node_modules` layout — which the current consumers use —
the library cannot see the application's dependencies that way, so `requires: 'typeorm'` would
always report missing.

The resolver must therefore search from the application's perspective:

```ts
import { createRequire } from 'node:module';

const searchPaths = (): string[] => [
  process.cwd(),
  ...(require.main?.paths ?? []),
  __dirname,
];

export const canResolve = (id: string): boolean => {
  try {
    require.resolve(id, { paths: searchPaths() });
    return true;
  } catch {
    return false;
  }
};
```

This is a correctness requirement, not an optimization. It gets its own unit test with a fixture
directory layout that mimics pnpm's structure.

## Components

### `core/config.ts`

Two types: an input type that consumers write by hand, and a resolved type the rest of the package
consumes.

```ts
export interface ObservabilityConfigInput {
  service?: { name?: string; version?: string; environment?: string };
  resource?: { attributes?: Record<string, string> };
  traces?:  { exporter?: SpanExporterSpec | SpanExporterSpec[]; endpoint?: string;
              ignoreRoutes?: string[]; sampler?: SamplerSpec };
  metrics?: { exporter?: MetricExporterSpec | MetricExporterSpec[]; endpoint?: string;
              exportIntervalMs?: number; port?: number };
  logs?:    { exporter?: LogExporterSpec | LogExporterSpec[]; endpoint?: string };
  instrumentations?: Record<string, InstrumentationEntry>;
  logging?: LoggingConfigInput;
  redaction?: RedactionConfigInput;  // keys accepted as string[], resolved to Set<string>
  diagnostics?: { level?: 'none' | 'error' | 'warn' | 'info' | 'debug' };
}

export interface ObservabilityConfig { /* fully resolved; redaction.keys is Set<string> */ }

export const defineConfig = (
  overrides: ObservabilityConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): ObservabilityConfig =>
  deepMerge(defaults(), fromEnv(env), normalize(overrides));
```

`env` is a parameter so precedence can be tested without mutating the real environment. `normalize`
converts input shapes to resolved shapes — notably `string[]` redaction keys to a lowercased `Set`.

The existing helpers in `src/helpers.ts` (`isTrue`, `commaStringToList`, `commaStringToLowerSet`,
`intFromEnv`) move into `fromEnv` unchanged; they are already pure and correct.

`registerAs` and the `@nestjs/config` import are removed from this file entirely.

### `node/instrumentations.ts`

```ts
export interface InstrumentationDescriptor {
  name: string;                        // 'typeorm'
  module: string;                      // '@opentelemetry/instrumentation-typeorm'
  export?: string;                     // named export; falls back to default
  requires?: string;                   // 'typeorm' — the library being instrumented
  enabled?: boolean;
  config?: Record<string, unknown>;
  /** Set by the merge step, not by consumers: true when this descriptor was
   *  named in user config or in OTEL_INSTRUMENTATIONS. Drives log level. */
  explicit?: boolean;
}

export type InstrumentationEntry =
  | boolean                            // false disables a built-in
  | Partial<InstrumentationDescriptor> // patch a built-in or declare a new one
  | Instrumentation;                   // a constructed instance, passed through
```

The resolver applies two independent gates:

```ts
export const resolveInstrumentations = (
  descriptors: InstrumentationDescriptor[],
  diag: Diagnostics,
): Instrumentation[] => {
  const out: Instrumentation[] = [];

  for (const d of descriptors) {
    if (d.enabled === false) continue;

    // gate 1 — is the instrumented library present in the app at all?
    if (d.requires && !canResolve(d.requires)) {
      diag.log(d.explicit ? 'warn' : 'debug',
        `skip ${d.name}: ${d.requires} is not installed`);
      continue;
    }

    // gate 2 — is the instrumentation package itself installed?
    if (!canResolve(d.module)) {
      diag.log(d.explicit ? 'warn' : 'debug',
        `skip ${d.name}: install ${d.module} to enable it`);
      continue;
    }

    const mod = require(d.module);
    const Ctor = d.export ? mod[d.export] : (mod.default ?? firstConstructor(mod));
    if (typeof Ctor !== 'function') {
      diag.warn(`skip ${d.name}: ${d.module} exports no usable constructor`);
      continue;
    }
    out.push(new Ctor(d.config ?? {}));
  }

  return out;
};
```

`explicit` is set by the merge step when a descriptor was named in user config or enabled via the
`OTEL_INSTRUMENTATIONS` environment variable, and is false for catalog defaults. This gives the
log-level behavior from the decisions table: auto-detection is quiet, a stated intent that cannot be
honored is loud.

The catalog is plain data:

```ts
export const defaultCatalog = (cfg: ObservabilityConfig): InstrumentationDescriptor[] => [
  { name: 'http',    module: '@opentelemetry/instrumentation-http',
    config: { ignoreIncomingRequestHook: ignoreBy(cfg.traces.ignoreRoutes) } },
  { name: 'express', module: '@opentelemetry/instrumentation-express', requires: 'express',
    config: { ignoreLayersType: ['middleware'] } },
  { name: 'nestjs',  module: '@opentelemetry/instrumentation-nestjs-core', requires: '@nestjs/core' },
  { name: 'kafkajs', module: '@opentelemetry/instrumentation-kafkajs', requires: 'kafkajs' },
  { name: 'typeorm', module: '@opentelemetry/instrumentation-typeorm', requires: 'typeorm',
    config: { enhancedDatabaseReporting: true } },
  { name: 'pg',      module: '@opentelemetry/instrumentation-pg', requires: 'pg' },
  { name: 'ioredis', module: '@opentelemetry/instrumentation-ioredis', requires: 'ioredis' },
  { name: 'fs',      module: '@opentelemetry/instrumentation-fs', enabled: false },
];
```

`ignoreLayersType` uses the string literal `'middleware'` rather than the `ExpressLayerType` enum, so
the catalog does not import the Express instrumentation package to describe it.

Consumer overrides merge by name:

```ts
instrumentations: {
  http:    { config: { ignoreIncomingRequestHook: myHook } },  // patch a built-in
  typeorm: false,                                              // disable
  amqplib: { module: '@opentelemetry/instrumentation-amqplib', requires: 'amqplib' },
  custom:  new MyOwnInstrumentation(),                         // pass an instance
}
```

Environment control: `OTEL_INSTRUMENTATIONS` (allowlist by name) and
`OTEL_INSTRUMENTATIONS_DISABLED` (denylist). `auto-instrumentations-node` remains reachable as a
single opt-in descriptor for consumers who want the full set, but stops being the default.

### `node/exporters.ts`

```ts
export type SpanExporterSpec =
  | 'otlp-http' | 'otlp-grpc' | 'otlp-proto' | 'console' | 'none'
  | SpanExporter | (() => SpanExporter);
```

Metric specs additionally accept `'prometheus'`. Each named spec maps to a module id resolved
through the same `canResolve` gate. A named spec whose package is missing is a **hard error** with a
message naming the package to install — unlike instrumentations, an exporter was explicitly
requested and silently dropping it would hide all telemetry.

`'console'` maps to `ConsoleSpanExporter` from `@opentelemetry/sdk-trace-base`, which is already a
transitive requirement of `sdk-node`, so the console path has no additional install cost. This is
what makes a bare install produce working output with no collector.

Array specs fan out to multiple exporters for the same signal. `'none'` disables the signal.

`'prometheus'` constructs a `PrometheusExporter` from `@opentelemetry/exporter-prometheus`, which is
itself a `MetricReader` and is passed to `metricReaders` directly rather than wrapped in a
`PeriodicExportingMetricReader`.

Default per signal when nothing is configured: `otlp-http`, preserving current behavior for existing
consumers.

### `core/logger.ts`

```ts
export interface ObsLogger {
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  child(bindings: object): ObsLogger;
}
```

Core ships a no-op logger and a console logger. The `./pino` subpath ships `createPinoLogger(config)`
and the `pino-http` configuration currently in `src/logging/pino.config.ts`.

`src/logging/redact.ts` and `src/logging/serializers.ts` are already pure and logger-independent.
They move to `core/` unchanged and become reusable by any binding. `src/logging/body-capture.ts`
is also pure and moves to core.

### `core/telemetry.ts`

Replaces the module-level singletons at `src/tracing/tracer.ts:10-14` with lazy accessors:

```ts
let cached: { tracer: Tracer; meter: Meter } | undefined;

const handles = () => (cached ??= {
  tracer: trace.getTracer(config().service.name, config().service.version),
  meter:  metrics.getMeter(config().service.name, config().service.version),
});

export const getTracer = () => handles().tracer;
export const getMeter  = () => handles().meter;
```

`withSpan` keeps its current signature and behavior. `getRequestContext` is fixed to return
`undefined` when no span is active, rather than starting an orphan span it never ends:

```ts
export const getRequestContext = (): { traceId: string; spanId: string } | undefined => {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx ? { traceId: ctx.traceId, spanId: ctx.spanId } : undefined;
};
```

This is a breaking signature change; it is listed in the migration section.

`TelemetryService` keeps its counter and histogram caching, but reads through `getMeter()` instead of
a module-scope `meter`, and moves to core as a plain class with no `@Injectable()` decorator. The
Nest adapter re-exports a decorated subclass.

### `nestjs/`

`ObservabilityModule.forRoot(input?: ObservabilityConfigInput)` resolves the config once via
`defineConfig` and provides the result under a plain `OBSERVABILITY_CONFIG` token.
`forRootAsync({ inject, useFactory })` covers consumers who want to build the input from
`ConfigService`. `@nestjs/config` becomes an optional peer used by neither path.

`ObservabilityModuleOptions.global` is separated from the telemetry config rather than spread into
it, fixing the current leak of a meaningless `global` key into the config object.

`HttpClientLogger` moves its `@nestjs/axios` import inside the conditional registration path so
axios is only loaded when `logging.httpClient` is on.

The interceptor and exception filter change only their injection token. Their logic, including the
`getRPCMetadata` route-backfill in `RequestExceptionFilter`, is preserved as-is.

## Data flow

Unchanged in substance; the difference is where the wiring decisions are made.

```
process.env ─┐
             ├─> defineConfig() ─> ObservabilityConfig ─┬─> resolveInstrumentations() ─> Instrumentation[]
overrides ───┘                                          ├─> resolveExporters()        ─> exporters / readers
                                                        └─> createLogger()            ─> ObsLogger
                                                                    │
                                            NodeSDK(resource, instrumentations, exporters)
                                                                    │
                                       ┌────────────────────────────┴──────────────────┐
                                   traces                                       metrics / logs
                                       │                                                │
                        console | otlp-http | otlp-grpc | BYO         console | prometheus | otlp | BYO
```

Request-path flow through the Nest adapter — pino-http request log, `RequestBodyInterceptor`
capturing the response body into the `WeakMap`, serializers reading it back, `RequestExceptionFilter`
capturing error bodies — is unchanged from the current implementation.

## Error handling

- **Optional peer missing, instrumentation:** skip, log at `warn` if explicitly requested and
  `debug` otherwise. Never throw. A missing instrumentation degrades detail; it should not stop the
  application.
- **Optional peer missing, exporter:** throw at bootstrap with a message naming the package. A
  missing exporter means no telemetry reaches anything, which must not be silent.
- **Malformed descriptor** (module resolves but exports no constructor): skip with a `warn`.
- **Exporter runtime failure** (collector unreachable): delegated to the OTel SDK's own retry and
  backoff. The package adds a startup diagnostic naming the configured endpoint so the failure is
  attributable.
- **Diagnostics channel:** a `Diagnostics` object honoring `config.diagnostics.level`, wired to
  `@opentelemetry/api`'s `diag` when the level is above `none`. Bootstrap must never write to
  stdout unconditionally.
- **Double bootstrap:** guarded by a module-scope flag; a second call logs a `warn` and returns the
  existing SDK rather than double-patching.

## Testing

There are currently no tests. The plan targets these, in order of value:

1. **Config resolution** — precedence (programmatic > env > default), deep merge preserving sibling
   keys, `string[]` to `Set` normalization, each env parser against valid and malformed input.
   Pure functions with `env` injected; no global mutation.
2. **Instrumentation resolver** — both gates independently, `explicit` log-level behavior, override
   merge by name, disable via `false`, pass-through of live instances, malformed-export handling.
   `canResolve` stubbed.
3. **pnpm resolution** — fixture directory mimicking pnpm's non-hoisted layout, asserting that a
   dependency of the fixture "app" is found from the library's position. Guards the resolution
   requirement described under "Dependency resolution under pnpm".
4. **Exporter registry** — each named spec produces the expected instance type; a missing package
   throws with the package name in the message; array specs fan out; `'none'` disables.
5. **Redaction and serialization** — key matching, depth limit, char truncation, unserializable
   input, header sanitization. These are pure and currently untested despite being the
   security-relevant part of the package.
6. **Telemetry facade** — `withSpan` records exceptions and sets `ERROR` status on throw and always
   ends the span; `getRequestContext` returns `undefined` with no active span. Uses
   `InMemorySpanExporter`.
7. **Nest integration** — a `supertest` app asserting request log shape, response body capture,
   error body capture, and that trace context propagates. One end-to-end test, not a suite.

Jest is already configured via `jest.config.cts`.

## Migration for existing consumers

Existing monorepo services must keep working with a small, mechanical change.

- **Environment variables are unchanged.** All current names (`OTEL_SERVICE_NAME`, `MS_NAME`,
  `LOG_LEVEL`, `LOG_EXCLUDE_ROUTES`, `OTEL_TYPEORM_ENABLED`, and the rest) continue to be read.
  `OTEL_TYPEORM_ENABLED` and `OTEL_KAFKAJS_ENABLED` become overrides on top of auto-detection rather
  than the sole switch.
- **Default exporter stays `otlp-http`**, so a service that changes nothing keeps exporting to the
  existing collector.
- **`import '@libs/observability/bootstrap'` becomes `import '@yourscope/observability/register'`.**
  One line per service.
- **`dotenv` is no longer loaded by the library.** Services relying on it add `-r dotenv/config` to
  their start command, or call `dotenv.config()` themselves before the register import.
- **Instrumentation packages move to the service's own `package.json`.** A service using TypeORM
  tracing installs `@opentelemetry/instrumentation-typeorm` directly. This is the one non-mechanical
  step; the startup `warn` names the exact package when it is missing.
- **`getRequestContext` may now return `undefined`.** Call sites need a null check. It is not
  currently exported from `src/index.ts`, so the blast radius is limited to internal use.

## Publishing checklist

- Rename from `@libs/observability` to a public scope; reset version to `0.1.0`.
- `publishConfig.access: "public"`.
- `exports` map covering the five entry points, with `types` first in each condition.
- `peerDependenciesMeta` marking every optional peer.
- Remove `dotenv` from dependencies.
- Remove the internal Bitbucket install instructions and the reference to the non-existent
  `release.ps1` from the README; document `npm install` and the optional-peer matrix instead.
- `LICENSE` file (package.json already declares MIT; the file is not present).
- `repository`, `homepage`, and `bugs` fields.
- CI: build, test, `npm publish --provenance` on tag.
- `.npmignore` or `files` verified against `npm pack --dry-run` so `dist` ships and nothing else
  does.

The `docker-compose.yml`, `grafana/`, and `otel-collector/` directories stay in the repository as a
local development stack but are excluded from the published tarball.

## Rollout

Four independently reviewable stages:

1. Core extraction — config builder, pure helpers, telemetry facade, logger interface, tests.
   No behavior change for consumers.
2. Node bootstrap — instrumentation resolver, exporter registry, register entry.
3. Nest adapter — retarget to the new config token, split optional imports.
4. Packaging and release — entry points, peer metadata, docs, CI.
