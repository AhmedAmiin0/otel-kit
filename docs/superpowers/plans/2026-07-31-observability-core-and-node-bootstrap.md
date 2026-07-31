# Observability Core + Node Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `@libs/observability` into a standalone, buildable package with a framework-agnostic core and a Node bootstrap that resolves instrumentations and exporters at runtime instead of importing them statically.

**Architecture:** Two layers. `src/core/` depends on nothing but `@opentelemetry/api` and holds config resolution, redaction, the logger interface, and a lazy telemetry facade. `src/node/` builds the `NodeSDK` by resolving optional peer packages through `require.resolve` gates, so instrumentations and exporters are selected by what the consuming app actually has installed. NestJS and packaging are explicitly out of scope for this plan.

**Tech Stack:** TypeScript 5.8 (CommonJS output), Jest 29 + ts-jest, `@opentelemetry/api` 1.9, OpenTelemetry SDK 2.x line.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-31-observability-package-decoupling-design.md`. Every task traces to a section there.
- **Only `@opentelemetry/api` may appear in `dependencies`.** Everything else is a peer, an optional peer, or a devDependency.
- **No module-scope import from an optional peer.** Optional peers are reached only via `require()` inside a function body, after a `canResolve` gate. `src/register.ts` is the single exception.
- **Module format is CommonJS.** No ESM output in this plan.
- **Config precedence is programmatic override > environment variable > default.**
- **Missing optional peer log level:** `warn` when explicitly requested, `debug` when merely defaulted.
- **Instrumentations never throw on a missing package; exporters always throw on a missing package.**
- **TDD.** Every task writes a failing test first, verifies the failure, then implements. Commit at the end of every task.
- **Existing pure code moves unchanged.** `redact.ts`, `serializers.ts`, `body-capture.ts`, and the four helpers in `helpers.ts` are correct today; relocate them without rewriting logic.

## Out of scope for this plan

Stage 3 (NestJS adapter retarget) and Stage 4 (packaging, npm scope rename, CI release) from the spec's rollout section get their own plan once this one lands. The existing `src/observability.module.ts`, `src/logging/*.interceptor.ts`, `src/logging/*.filter.ts`, and `src/logging/http-client.logger.ts` are **left untouched and still compiling** throughout this plan.

## File Structure

**Created:**

```text
src/core/config/types.ts          ObservabilityConfigInput, ObservabilityConfig, sub-types
src/core/config/merge.ts          deepMerge — plain objects recurse, everything else replaces
src/core/config/env.ts            fromEnv() + the four pure helpers moved from src/helpers.ts
src/core/config/defaults.ts       defaults()
src/core/config/define-config.ts  defineConfig()
src/core/diagnostics.ts           Diagnostics — level-gated logging for bootstrap
src/core/logger/types.ts          ObsLogger interface
src/core/logger/noop.ts           noopLogger
src/core/logger/console.ts        createConsoleLogger
src/core/redaction/redact.ts      moved from src/logging/redact.ts
src/core/redaction/serializers.ts moved from src/logging/serializers.ts
src/core/redaction/body-capture.ts moved from src/logging/body-capture.ts
src/core/telemetry/handles.ts     lazy getTracer/getMeter + resetHandles for tests
src/core/telemetry/spans.ts       withSpan, getRequestContext
src/core/telemetry/telemetry.ts   Telemetry class, undecorated
src/core/index.ts                 core barrel
src/node/resolve.ts               resolutionPaths, canResolve, requireOptional
src/node/instrumentations/types.ts    InstrumentationDescriptor, InstrumentationEntry
src/node/instrumentations/catalog.ts  defaultCatalog
src/node/instrumentations/merge.ts    mergeInstrumentations
src/node/instrumentations/resolve.ts  resolveInstrumentations
src/node/exporters/types.ts       exporter spec types + EXPORTER_MODULES table
src/node/exporters/signals.ts     resolveTraceExporters, resolveLogExporters
src/node/exporters/metrics.ts     resolveMetricReaders
src/node/sdk.ts                   createSdk + start guard
src/node/shutdown.ts              registerShutdownHooks (moved, hardened)
src/node/index.ts                 node barrel
src/register.ts                   side-effect preload entry
test/fixtures/app/node_modules/fixture-lib/{package.json,index.js}
```

**Modified:** `package.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.cts`, `eslint.config.mjs`.

**Deleted at the end:** `src/helpers.ts`, `src/bootstrap.ts`, `src/bootstrap/`, `src/tracing/tracer.ts`, `src/logging/redact.ts`, `src/logging/serializers.ts`, `src/logging/body-capture.ts` — each only after its replacement is green and its importers are updated.

---

### Task 1: Detach the repo from the monorepo and get a green test run

Nothing in this repo builds today. `tsconfig.json` extends `../../tsconfig.base.json`, `jest.config.cts` presets `../../jest.preset.js`, and `eslint.config.mjs` imports `../../eslint.config.mjs` — none of those parents exist. `node_modules/typescript/` is an empty directory. There is no lockfile and no jest. This task is a prerequisite for every other task.

**Files:**
- Modify: `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.cts`, `eslint.config.mjs`, `package.json`
- Delete: `project.json` (Nx project descriptor referencing `../../node_modules/nx`)
- Test: `src/core/smoke.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test` and `npm run build`. Every later task depends on these two commands.

- [ ] **Step 1: Replace the monorepo-rooted tsconfig**

`tsconfig.json` — inline what `../../tsconfig.base.json` used to provide:

```json
{
  "compilerOptions": {
    "target": "es2021",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["es2021"],
    "types": ["node"],
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "importHelpers": true,
    "strict": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "files": [],
  "include": [],
  "references": [{ "path": "./tsconfig.lib.json" }, { "path": "./tsconfig.spec.json" }]
}
```

- [ ] **Step 2: Point the lib and spec tsconfigs at the new base**

`tsconfig.lib.json` keeps `"extends": "./tsconfig.json"` and its existing `rootDir`/`outDir`/`include`/`exclude`. Delete the compiler options it now inherits (`target`, `experimentalDecorators`, `emitDecoratorMetadata`, `strictNullChecks`, `noImplicitAny`, `strictBindCallApply`, `forceConsistentCasingInFileNames`, `noFallthroughCasesInSwitch`), keeping only:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/tsconfig.lib.tsbuildinfo",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.spec.ts", "src/**/*.test.ts", "jest.config.cts"]
}
```

`tsconfig.spec.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/out-tsc",
    "rootDir": ".",
    "types": ["jest", "node"]
  },
  "include": ["src/**/*.spec.ts", "src/**/*.d.ts", "test/**/*.ts"]
}
```

`moduleResolution` changes from `"bundler"` to the inherited `"node"` — `bundler` is wrong for a CommonJS library and would let imports typecheck that fail at runtime.

- [ ] **Step 3: Make the jest config standalone**

`jest.config.cts` — drop the missing preset:

```javascript
module.exports = {
  displayName: 'observability',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: 'coverage',
  // fixture packages under test/fixtures must never be treated as test roots
  modulePathIgnorePatterns: ['<rootDir>/test/fixtures/'],
};
```

`passWithNoTests` is removed deliberately: from this task on, an empty test run is a failure.

- [ ] **Step 4: Neutralize the eslint config**

`eslint.config.mjs` — the parent it imports does not exist:

```javascript
export default [];
```

Leaving it as an empty flat config keeps `eslint` runnable without inventing a rule set this plan has no basis to choose. Populating it is a Stage 4 concern.

- [ ] **Step 5: Delete the Nx project descriptor**

```bash
git rm project.json
```

It references `../../node_modules/nx/schemas/project-schema.json` and defines a build target that duplicates the `build` script. Neither works standalone.

- [ ] **Step 6: Add scripts and dev dependencies**

In `package.json`, add to `scripts`:

```json
"test": "jest",
"test:watch": "jest --watch",
"typecheck": "tsc -b tsconfig.lib.json --dry"
```

Then install the toolchain:

```bash
npm install --save-dev jest@^29.7.0 ts-jest@^29.2.5 @types/jest@^29.5.14 typescript@~5.8.2
```

This also repairs the empty `node_modules/typescript/` directory and creates the missing lockfile.

- [ ] **Step 7: Write the smoke test**

Create `src/core/smoke.spec.ts`:

```typescript
describe('toolchain', () => {
  it('runs typescript tests', () => {
    const value: string = 'ok';
    expect(value).toBe('ok');
  });
});
```

- [ ] **Step 8: Run the test and the build**

```bash
npm test
npm run build
```

Expected: one passing test, and `dist/` produced with `.js` and `.d.ts` files. If the build fails on a missing `@opentelemetry/*` type, install that package as a devDependency — the existing `dependencies` block is left alone in this task.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "build: detach package from monorepo and restore a working toolchain

tsconfig, jest, and eslint all referenced ../../ paths from the Nx
monorepo that do not exist in this repository, and node_modules/typescript
was empty, so neither build nor test could run. Inline the base tsconfig,
make the jest config standalone, drop the Nx project descriptor, and add
jest + ts-jest."
```

---

### Task 2: Config types and deep merge

**Files:**
- Create: `src/core/config/types.ts`, `src/core/config/merge.ts`
- Test: `src/core/config/merge.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `deepMerge<T>(base: T, ...overrides: unknown[]): T`. Consumed by Task 4 (`defineConfig`) and Task 13 (instrumentation merge).
- Produces: `ObservabilityConfig` and `ObservabilityConfigInput` types, consumed by every later task.

The merge rule matters more than it looks. `src/config.ts:51` uses a shallow spread today, which is exactly the bug being fixed (P3 in the spec). But a naive recursive merge is also wrong: it would try to merge a user-supplied `SpanExporter` **instance** or an `Instrumentation` instance key-by-key and destroy it. The rule is: plain objects recurse, arrays replace wholesale, everything else replaces.

- [ ] **Step 1: Write the failing test**

Create `src/core/config/merge.spec.ts`:

```typescript
import { deepMerge } from './merge';

describe('deepMerge', () => {
  it('preserves sibling keys the override does not mention', () => {
    const base = { logging: { level: 'info', pretty: true, headers: true } };
    const result = deepMerge(base, { logging: { level: 'debug' } });
    expect(result).toEqual({ logging: { level: 'debug', pretty: true, headers: true } });
  });

  it('replaces arrays instead of concatenating them', () => {
    const base = { traces: { ignoreRoutes: ['/health', '/metrics'] } };
    const result = deepMerge(base, { traces: { ignoreRoutes: ['/ping'] } });
    expect(result.traces.ignoreRoutes).toEqual(['/ping']);
  });

  it('replaces class instances wholesale rather than merging their fields', () => {
    class FakeExporter { constructor(public readonly id: string) {} }
    const base = { traces: { exporter: new FakeExporter('a') } };
    const next = new FakeExporter('b');
    const result = deepMerge(base, { traces: { exporter: next } });
    expect(result.traces.exporter).toBe(next);
  });

  it('ignores undefined override values but honours explicit null', () => {
    const base = { service: { name: 'svc', version: '1.0.0' } };
    const result = deepMerge(base, { service: { name: undefined } });
    expect(result.service.name).toBe('svc');
  });

  it('does not mutate the base object', () => {
    const base = { logging: { level: 'info' } };
    deepMerge(base, { logging: { level: 'debug' } });
    expect(base.logging.level).toBe('info');
  });

  it('applies later overrides over earlier ones', () => {
    const result = deepMerge({ a: 1 }, { a: 2 }, { a: 3 });
    expect(result.a).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/config/merge.spec.ts`
Expected: FAIL — `Cannot find module './merge'`.

- [ ] **Step 3: Implement deepMerge**

Create `src/core/config/merge.ts`:

```typescript
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
    (acc, override) =>
      isPlainObject(override) ? mergeTwo(acc, override) : acc,
    { ...(base as Record<string, unknown>) },
  ) as T;
```

The `Object.getPrototypeOf` check is what distinguishes a config literal from a `SpanExporter` instance — class instances have their own prototype and so fall through to replacement.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/core/config/merge.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the config types**

Create `src/core/config/types.ts`. The input type is what a consumer hand-writes; the resolved type is what the package passes around internally. The split exists so `redaction.keys` can be a friendly `string[]` on the way in and an efficient `Set<string>` once resolved — the current package leaks `Set<string>` into its public `.d.ts` via `typeof config`.

```typescript
import type { Instrumentation } from './instrumentation-shim';

export type DiagnosticLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

export interface ServiceConfig {
  name: string;
  version: string;
  environment?: string;
}

export interface RedactionConfig {
  keys: Set<string>;
  placeholder: string;
  bodyMaxChars: number;
  maxDepth: number;
}

export interface LoggingConfig {
  level: string;
  pretty: boolean;
  quietRequestLogger: boolean;
  headers: boolean;
  requestBody: boolean;
  responseBody: boolean;
  httpClient: boolean;
  kafka: boolean;
  kafkaBody: boolean;
  kafkaHeaders: boolean;
  excludeRoutes: string[];
  excludeTopics: string[];
  correlationIdHeader: string;
}

export interface TracesConfig {
  exporter: unknown;
  endpoint?: string;
  ignoreRoutes: string[];
}

export interface MetricsConfig {
  exporter: unknown;
  endpoint?: string;
  exportIntervalMs: number;
  port: number;
}

export interface LogsConfig {
  exporter: unknown;
  endpoint?: string;
}

export interface ObservabilityConfig {
  service: ServiceConfig;
  resource: { attributes: Record<string, string> };
  traces: TracesConfig;
  metrics: MetricsConfig;
  logs: LogsConfig;
  instrumentations: Record<string, unknown>;
  logging: LoggingConfig;
  redaction: RedactionConfig;
  diagnostics: { level: DiagnosticLevel };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface ObservabilityConfigInput
  extends DeepPartial<Omit<ObservabilityConfig, 'redaction' | 'instrumentations'>> {
  redaction?: Partial<Omit<RedactionConfig, 'keys'>> & { keys?: string[] };
  instrumentations?: Record<string, unknown>;
}

export type { Instrumentation };
```

Create `src/core/config/instrumentation-shim.ts` so core never imports `@opentelemetry/instrumentation`:

```typescript
/** Structural stand-in for @opentelemetry/instrumentation's Instrumentation.
 *  Core must not depend on that package; only src/node/ does. */
export interface Instrumentation {
  instrumentationName: string;
  instrumentationVersion: string;
  enable(): void;
  disable(): void;
}
```

The `exporter` fields are typed `unknown` in core on purpose: their concrete union lives in `src/node/exporters/types.ts` (Task 15) because it references SDK types that core must not import. Task 15 narrows them at the point of use.

- [ ] **Step 6: Verify the types compile**

Run: `npx tsc -p tsconfig.lib.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/config/
git commit -m "feat(core): add config types and a deep merge that respects instances

Replaces the shallow spread in src/config.ts:51, which discarded sibling
keys whenever a nested override was supplied. Plain objects recurse,
arrays and class instances replace, so a user-supplied exporter instance
survives the merge intact."
```

---

### Task 3: Environment parsing

**Files:**
- Create: `src/core/config/env.ts`
- Test: `src/core/config/env.spec.ts`
- Reference (do not delete yet): `src/helpers.ts`, `src/config.ts:4-49`

**Interfaces:**
- Consumes: `ObservabilityConfigInput` from Task 2.
- Produces: `fromEnv(env: NodeJS.ProcessEnv): ObservabilityConfigInput`, plus the four helpers `isTrue`, `commaStringToList`, `commaStringToLowerSet`, `intFromEnv`. Consumed by Task 4.

`env` being a parameter rather than a module-scope capture is the whole point — it makes precedence testable without mutating the real `process.env`, and it fixes the import-time snapshot at `src/config.ts:4`.

- [ ] **Step 1: Write the failing test**

Create `src/core/config/env.spec.ts`:

```typescript
import { fromEnv, isTrue, commaStringToList, intFromEnv } from './env';

describe('helpers', () => {
  it('parses truthy strings case-insensitively', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
      expect(isTrue(v, false)).toBe(true);
    }
  });

  it('returns the fallback only for undefined', () => {
    expect(isTrue(undefined, true)).toBe(true);
    expect(isTrue('', true)).toBe(false);
    expect(isTrue('nonsense', true)).toBe(false);
  });

  it('splits and trims comma lists, dropping empties', () => {
    expect(commaStringToList(' a , ,b ,')).toEqual(['a', 'b']);
  });

  it('falls back when an int cannot be parsed', () => {
    expect(intFromEnv('42', 7)).toBe(42);
    expect(intFromEnv('abc', 7)).toBe(7);
    expect(intFromEnv(undefined, 7)).toBe(7);
  });
});

describe('fromEnv', () => {
  it('returns an empty object when nothing is set', () => {
    expect(fromEnv({})).toEqual({});
  });

  it('prefers OTEL_SERVICE_NAME over MS_NAME', () => {
    const result = fromEnv({ OTEL_SERVICE_NAME: 'a', MS_NAME: 'b' });
    expect(result.service?.name).toBe('a');
  });

  it('falls back to MS_NAME', () => {
    expect(fromEnv({ MS_NAME: 'b' }).service?.name).toBe('b');
  });

  it('ignores a whitespace-only service name', () => {
    expect(fromEnv({ OTEL_SERVICE_NAME: '   ', MS_NAME: 'b' }).service?.name).toBe('b');
  });

  it('omits keys that are not set rather than emitting undefined', () => {
    const result = fromEnv({ LOG_LEVEL: 'debug' });
    expect(result.logging).toEqual({ level: 'debug' });
    expect('traces' in result).toBe(false);
  });

  it('reads redaction keys as an array', () => {
    expect(fromEnv({ LOG_RESPONSE_BODY_REDACT: 'a,B' }).redaction?.keys).toEqual(['a', 'B']);
  });

  it('maps OTEL_IGNORE_ROUTES to traces.ignoreRoutes', () => {
    expect(fromEnv({ OTEL_IGNORE_ROUTES: '/a,/b' }).traces?.ignoreRoutes).toEqual(['/a', '/b']);
  });

  it('defaults traces.ignoreRoutes to the log exclusion list', () => {
    expect(fromEnv({ LOG_EXCLUDE_ROUTES: '/x' }).traces?.ignoreRoutes).toEqual(['/x']);
  });

  it('translates the legacy per-instrumentation enable flags', () => {
    const result = fromEnv({ OTEL_TYPEORM_ENABLED: 'true', OTEL_KAFKAJS_ENABLED: 'false' });
    expect(result.instrumentations).toEqual({ typeorm: { enabled: true }, kafkajs: { enabled: false } });
  });

  it('reads the instrumentation allow and deny lists', () => {
    const result = fromEnv({ OTEL_INSTRUMENTATIONS: 'http,pg', OTEL_INSTRUMENTATIONS_DISABLED: 'fs' });
    expect(result.instrumentations).toEqual({
      http: { enabled: true, explicit: true },
      pg: { enabled: true, explicit: true },
      fs: { enabled: false },
    });
  });
});
```

`fromEnv` must **omit** unset keys rather than emit `undefined` values. `deepMerge` already skips `undefined`, but omitting keeps the returned object honest and the tests readable.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/config/env.spec.ts`
Expected: FAIL — `Cannot find module './env'`.

- [ ] **Step 3: Implement env parsing**

Create `src/core/config/env.ts`. Copy the four helpers verbatim from `src/helpers.ts` — they are already correct — then add `fromEnv`:

```typescript
import type { ObservabilityConfigInput } from './types';

export const isTrue = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : /^(1|true|yes|on)$/i.test(value.trim());

export const commaStringToList = (value: string): string[] =>
  value.split(',').map((entry) => entry.trim()).filter(Boolean);

export const commaStringToLowerSet = (value: string): Set<string> =>
  new Set(commaStringToList(value).map((entry) => entry.toLowerCase()));

export const intFromEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/** Assigns only when `value` is defined, so unset env vars leave no key behind. */
const put = <T>(target: Record<string, unknown>, key: string, value: T | undefined): void => {
  if (value !== undefined) target[key] = value;
};

const section = (
  out: Record<string, unknown>,
  name: string,
  build: (bag: Record<string, unknown>) => void,
): void => {
  const bag: Record<string, unknown> = {};
  build(bag);
  if (Object.keys(bag).length > 0) out[name] = bag;
};

const bool = (raw: string | undefined): boolean | undefined =>
  raw === undefined ? undefined : isTrue(raw, false);

const list = (raw: string | undefined): string[] | undefined =>
  raw === undefined ? undefined : commaStringToList(raw);

const int = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  // Must not use `|| undefined` here — that would silently drop a configured 0.
  return Number.isNaN(parsed) ? undefined : parsed;
};

export const fromEnv = (env: NodeJS.ProcessEnv): ObservabilityConfigInput => {
  const out: Record<string, unknown> = {};

  section(out, 'service', (s) => {
    put(s, 'name', env.OTEL_SERVICE_NAME?.trim() || env.MS_NAME?.trim() || undefined);
    put(s, 'version', env.OTEL_SERVICE_VERSION);
    put(s, 'environment', env.OTEL_ENVIRONMENT ?? env.NODE_ENV);
  });

  section(out, 'logging', (l) => {
    put(l, 'level', env.LOG_LEVEL);
    put(l, 'pretty', bool(env.LOG_PRETTY));
    put(l, 'quietRequestLogger', bool(env.LOG_QUIET_REQ));
    put(l, 'headers', bool(env.LOG_HEADERS));
    put(l, 'requestBody', bool(env.LOG_REQUEST_BODY));
    put(l, 'responseBody', bool(env.LOG_RESPONSE_BODY));
    put(l, 'httpClient', bool(env.LOG_HTTP_CLIENT));
    put(l, 'kafka', bool(env.LOG_KAFKA));
    put(l, 'kafkaBody', bool(env.LOG_KAFKA_BODY));
    put(l, 'kafkaHeaders', bool(env.LOG_KAFKA_HEADERS));
    put(l, 'excludeRoutes', list(env.LOG_EXCLUDE_ROUTES));
    put(l, 'excludeTopics', list(env.LOG_EXCLUDE_TOPICS));
    put(l, 'correlationIdHeader', env.LOG_CORRELATION_HEADER?.toLowerCase());
  });

  section(out, 'redaction', (r) => {
    put(r, 'keys', list(env.LOG_RESPONSE_BODY_REDACT));
    put(r, 'placeholder', env.LOG_REDACTED);
    put(r, 'bodyMaxChars', int(env.LOG_BODY_MAX_CHARS));
    put(r, 'maxDepth', int(env.LOG_BODY_MAX_DEPTH));
  });

  section(out, 'traces', (t) => {
    put(t, 'exporter', env.OTEL_TRACES_EXPORTER);
    put(t, 'endpoint', env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
    // OTEL_IGNORE_ROUTES wins; otherwise reuse the log exclusion list, matching src/config.ts:38
    put(t, 'ignoreRoutes', list(env.OTEL_IGNORE_ROUTES) ?? list(env.LOG_EXCLUDE_ROUTES));
  });

  section(out, 'metrics', (m) => {
    put(m, 'exporter', env.OTEL_METRICS_EXPORTER);
    put(m, 'endpoint', env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT);
    put(m, 'exportIntervalMs', int(env.OTEL_METRIC_EXPORT_INTERVAL));
    put(m, 'port', int(env.OTEL_PROMETHEUS_PORT));
  });

  section(out, 'logs', (l) => {
    put(l, 'exporter', env.OTEL_LOGS_EXPORTER);
    put(l, 'endpoint', env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT);
  });

  section(out, 'diagnostics', (d) => put(d, 'level', env.OTEL_DIAG_LEVEL));

  const instrumentations: Record<string, unknown> = {};
  for (const name of commaStringToList(env.OTEL_INSTRUMENTATIONS ?? '')) {
    instrumentations[name] = { enabled: true, explicit: true };
  }
  for (const name of commaStringToList(env.OTEL_INSTRUMENTATIONS_DISABLED ?? '')) {
    instrumentations[name] = { enabled: false };
  }
  // Legacy flags from src/config.ts:41-46, kept working per the spec's migration section.
  const typeorm = bool(env.OTEL_TYPEORM_ENABLED);
  if (typeorm !== undefined) instrumentations['typeorm'] = { enabled: typeorm };
  const kafkajs = bool(env.OTEL_KAFKAJS_ENABLED);
  if (kafkajs !== undefined) instrumentations['kafkajs'] = { enabled: kafkajs };

  if (Object.keys(instrumentations).length > 0) out['instrumentations'] = instrumentations;

  return out as ObservabilityConfigInput;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/core/config/env.spec.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/env.ts src/core/config/env.spec.ts
git commit -m "feat(core): parse configuration from an injected environment

Takes env as a parameter instead of capturing process.env at module load
(src/config.ts:4), so precedence is testable without mutating the real
environment. Legacy OTEL_TYPEORM_ENABLED and OTEL_KAFKAJS_ENABLED keep
working, translated into per-instrumentation entries."
```

---

### Task 4: defaults() and defineConfig()

**Files:**
- Create: `src/core/config/defaults.ts`, `src/core/config/define-config.ts`
- Test: `src/core/config/define-config.spec.ts`

**Interfaces:**
- Consumes: `deepMerge` (Task 2), `fromEnv` (Task 3), config types (Task 2).
- Produces: `defineConfig(overrides?: ObservabilityConfigInput, env?: NodeJS.ProcessEnv): ObservabilityConfig`. This is the package's primary public entry point; every later task consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/core/config/define-config.spec.ts`:

```typescript
import { defineConfig } from './define-config';

describe('defineConfig', () => {
  it('produces a usable config from an empty environment', () => {
    const cfg = defineConfig({}, {});
    expect(cfg.service.name).toBe('unknown-service');
    expect(cfg.traces.exporter).toBe('otlp-http');
    expect(cfg.metrics.exportIntervalMs).toBe(5000);
    expect(cfg.logging.excludeRoutes).toEqual(['/health', '/health-check', '/metrics']);
  });

  it('lets the environment override a default', () => {
    expect(defineConfig({}, { LOG_LEVEL: 'warn' }).logging.level).toBe('warn');
  });

  it('lets a programmatic override beat the environment', () => {
    const cfg = defineConfig({ logging: { level: 'debug' } }, { LOG_LEVEL: 'warn' });
    expect(cfg.logging.level).toBe('debug');
  });

  it('keeps sibling keys when a nested override is supplied', () => {
    const cfg = defineConfig({ logging: { level: 'debug' } }, {});
    expect(cfg.logging.headers).toBe(true);
    expect(cfg.logging.correlationIdHeader).toBe('x-request-id');
  });

  it('normalizes redaction keys to a lowercased Set', () => {
    const cfg = defineConfig({ redaction: { keys: ['Password', 'TOKEN'] } }, {});
    expect(cfg.redaction.keys).toBeInstanceOf(Set);
    expect(cfg.redaction.keys.has('password')).toBe(true);
    expect(cfg.redaction.keys.has('token')).toBe(true);
  });

  it('ships the documented default redaction keys', () => {
    const cfg = defineConfig({}, {});
    for (const key of ['password', 'token', 'secret', 'accesstoken', 'refreshtoken', 'apikey', 'authorization']) {
      expect(cfg.redaction.keys.has(key)).toBe(true);
    }
  });

  it('defaults pretty logging off when NODE_ENV is production', () => {
    expect(defineConfig({}, { NODE_ENV: 'production' }).logging.pretty).toBe(false);
    expect(defineConfig({}, { NODE_ENV: 'development' }).logging.pretty).toBe(true);
  });

  it('reads process.env when no environment is passed', () => {
    process.env['OTEL_SERVICE_NAME'] = 'from-real-env';
    try {
      expect(defineConfig().service.name).toBe('from-real-env');
    } finally {
      delete process.env['OTEL_SERVICE_NAME'];
    }
  });

  it('passes an exporter instance through untouched', () => {
    const exporter = { export: () => undefined, shutdown: async () => undefined };
    expect(defineConfig({ traces: { exporter } }, {}).traces.exporter).toBe(exporter);
  });

  it('does not mutate the overrides it is given', () => {
    const overrides = { logging: { level: 'debug' } };
    defineConfig(overrides, {});
    expect(overrides).toEqual({ logging: { level: 'debug' } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/config/define-config.spec.ts`
Expected: FAIL — `Cannot find module './define-config'`.

- [ ] **Step 3: Implement defaults**

Create `src/core/config/defaults.ts`. Values are carried over from `src/config.ts:11-49` so existing services see no behavior change:

```typescript
import type { ObservabilityConfig } from './types';

export const DEFAULT_REDACTION_KEYS = [
  'password', 'token', 'secret', 'accessToken',
  'refreshToken', 'apiKey', 'authorization',
];

export const defaults = (env: NodeJS.ProcessEnv): ObservabilityConfig => ({
  service: { name: 'unknown-service', version: '0.0.1' },
  resource: { attributes: {} },
  traces: { exporter: 'otlp-http', ignoreRoutes: ['/health', '/health-check', '/metrics'] },
  metrics: { exporter: 'otlp-http', exportIntervalMs: 5000, port: 9464 },
  logs: { exporter: 'otlp-http' },
  instrumentations: {},
  logging: {
    level: 'info',
    pretty: env.NODE_ENV !== 'production',
    quietRequestLogger: true,
    headers: true,
    requestBody: true,
    responseBody: true,
    httpClient: true,
    kafka: true,
    kafkaBody: true,
    kafkaHeaders: true,
    excludeRoutes: ['/health', '/health-check', '/metrics'],
    excludeTopics: [],
    correlationIdHeader: 'x-request-id',
  },
  redaction: {
    keys: new Set(DEFAULT_REDACTION_KEYS.map((k) => k.toLowerCase())),
    placeholder: 'XXXXXXXXXXXXXXXX',
    bodyMaxChars: 500,
    maxDepth: 8,
  },
  diagnostics: { level: 'none' },
});
```

The default redaction list fixes a latent bug in `src/config.ts:9`, where the keys were written as a **single-element array containing one comma-joined string** and then `.join(',')`-ed. That happened to work only because `commaStringToLowerSet` re-split it; expressed as a real array here, it is no longer accidental.

- [ ] **Step 4: Implement defineConfig**

Create `src/core/config/define-config.ts`:

```typescript
import { deepMerge } from './merge';
import { defaults } from './defaults';
import { fromEnv } from './env';
import type { ObservabilityConfig, ObservabilityConfigInput } from './types';

/** Converts input-shaped values to resolved-shaped ones (currently redaction.keys). */
const normalize = (input: ObservabilityConfigInput): Record<string, unknown> => {
  const out = { ...input } as Record<string, unknown>;
  const redaction = out['redaction'] as { keys?: string[] } | undefined;

  if (redaction?.keys !== undefined) {
    out['redaction'] = {
      ...redaction,
      keys: new Set(redaction.keys.map((k) => k.toLowerCase())),
    };
  }

  return out;
};

export const defineConfig = (
  overrides: ObservabilityConfigInput = {},
  env: NodeJS.ProcessEnv = process.env,
): ObservabilityConfig =>
  deepMerge(defaults(env), normalize(fromEnv(env)), normalize(overrides));
```

Precedence falls out of argument order: defaults, then environment, then programmatic. A `Set` is not a plain object, so `deepMerge` replaces it wholesale rather than merging — which is why `normalize` must run before the merge, on both the env and the override side.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/core/config/define-config.spec.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/config/
git commit -m "feat(core): add defineConfig with default/env/override precedence

Replaces the import-time config snapshot and its shallow-spread override
path. Programmatic overrides beat env vars, which beat defaults, and
nested overrides no longer discard their siblings."
```

---

### Task 5: Diagnostics

**Files:**
- Create: `src/core/diagnostics.ts`
- Test: `src/core/diagnostics.spec.ts`

**Interfaces:**
- Consumes: `DiagnosticLevel` from Task 2.
- Produces: `createDiagnostics(level: DiagnosticLevel, sink?: DiagnosticSink): Diagnostics` with methods `error`, `warn`, `info`, `debug`, and `log(level, message)`. Consumed by Tasks 14, 15, 16, 18.

Bootstrap currently writes to `console.log` unconditionally (`src/bootstrap/shutdown.ts:6`). A library must not do that. Every diagnostic in this plan routes through here.

- [ ] **Step 1: Write the failing test**

Create `src/core/diagnostics.spec.ts`:

```typescript
import { createDiagnostics } from './diagnostics';

describe('createDiagnostics', () => {
  const sink = () => {
    const calls: Array<[string, string]> = [];
    return { calls, write: (level: string, msg: string) => { calls.push([level, msg]); } };
  };

  it('suppresses everything at level none', () => {
    const s = sink();
    const diag = createDiagnostics('none', s.write);
    diag.error('boom');
    diag.debug('detail');
    expect(s.calls).toEqual([]);
  });

  it('emits at or above the configured level', () => {
    const s = sink();
    const diag = createDiagnostics('warn', s.write);
    diag.error('e');
    diag.warn('w');
    diag.info('i');
    diag.debug('d');
    expect(s.calls).toEqual([['error', 'e'], ['warn', 'w']]);
  });

  it('emits everything at debug', () => {
    const s = sink();
    const diag = createDiagnostics('debug', s.write);
    diag.debug('d');
    expect(s.calls).toEqual([['debug', 'd']]);
  });

  it('routes log(level, message) through the same gate', () => {
    const s = sink();
    const diag = createDiagnostics('warn', s.write);
    diag.log('debug', 'hidden');
    diag.log('warn', 'shown');
    expect(s.calls).toEqual([['warn', 'shown']]);
  });

  it('prefixes messages so the source is identifiable', () => {
    const s = sink();
    createDiagnostics('info', s.write).info('hello');
    expect(s.calls[0]?.[1]).toContain('hello');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/diagnostics.spec.ts`
Expected: FAIL — `Cannot find module './diagnostics'`.

- [ ] **Step 3: Implement diagnostics**

Create `src/core/diagnostics.ts`:

```typescript
import type { DiagnosticLevel } from './config/types';

export type DiagnosticSink = (level: Exclude<DiagnosticLevel, 'none'>, message: string) => void;

export interface Diagnostics {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
  log(level: Exclude<DiagnosticLevel, 'none'>, message: string): void;
}

const RANK: Record<DiagnosticLevel, number> = { none: 0, error: 1, warn: 2, info: 3, debug: 4 };

const consoleSink: DiagnosticSink = (level, message) => {
  const line = `[observability] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export const createDiagnostics = (
  level: DiagnosticLevel,
  sink: DiagnosticSink = consoleSink,
): Diagnostics => {
  const threshold = RANK[level];

  const log = (at: Exclude<DiagnosticLevel, 'none'>, message: string): void => {
    if (threshold === 0 || RANK[at] > threshold) return;
    sink(at, message);
  };

  return {
    log,
    error: (m) => log('error', m),
    warn: (m) => log('warn', m),
    info: (m) => log('info', m),
    debug: (m) => log('debug', m),
  };
};
```

The default sink prefixes `[observability]` so a consumer can tell where the line came from. Note the test asserts `toContain`, not equality, so the prefix is free to change.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/core/diagnostics.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/diagnostics.ts src/core/diagnostics.spec.ts
git commit -m "feat(core): add level-gated diagnostics for bootstrap

Bootstrap logging currently goes to console.log unconditionally. Route it
through a gate that defaults to silent."
```

---

### Task 6: Move redaction, serializers, and body capture into core

These three files are pure, correct, and completely untested — and they are the security-relevant part of the package. Move them verbatim and cover them.

**Files:**
- Create: `src/core/redaction/redact.ts`, `src/core/redaction/serializers.ts`, `src/core/redaction/body-capture.ts`
- Test: `src/core/redaction/redact.spec.ts`, `src/core/redaction/serializers.spec.ts`
- Modify: `src/logging/redact.ts`, `src/logging/serializers.ts`, `src/logging/body-capture.ts` → re-export shims
- Modify: `src/index.ts` (import paths only)

**Interfaces:**
- Consumes: `RedactionConfig`, `ObservabilityConfig` (Task 2).
- Produces: `redactBody`, `serializeBody`, `redactAndSerialize`, `buildSerializers`, `sanitizeHeaders`, `httpLogLevel`, `storeCapturedBody`, `readCapturedBody`. Consumed by Task 10 (barrel) and, later, the untouched Nest files.

- [ ] **Step 1: Move the three files**

```bash
git mv src/logging/redact.ts src/core/redaction/redact.ts
git mv src/logging/serializers.ts src/core/redaction/serializers.ts
git mv src/logging/body-capture.ts src/core/redaction/body-capture.ts
```

Then fix their imports: `../config` becomes `../config/types`, and in `serializers.ts` the `./body-capture` and `./redact` imports stay as-is since all three moved together. Change no logic.

- [ ] **Step 2: Leave re-export shims so the Nest files keep compiling**

The Nest files are out of scope for this plan but must not break. Create `src/logging/redact.ts`:

```typescript
export * from '../core/redaction/redact';
```

`src/logging/serializers.ts`:

```typescript
export * from '../core/redaction/serializers';
```

`src/logging/body-capture.ts`:

```typescript
export * from '../core/redaction/body-capture';
```

These shims are deleted in the Stage 3 plan when the Nest files are retargeted.

- [ ] **Step 3: Write the failing tests**

Create `src/core/redaction/redact.spec.ts`:

```typescript
import { redactBody, serializeBody, redactAndSerialize } from './redact';
import type { RedactionConfig } from '../config/types';

const redaction: RedactionConfig = {
  keys: new Set(['password', 'token']),
  placeholder: 'XXX',
  bodyMaxChars: 20,
  maxDepth: 3,
};

describe('redactBody', () => {
  it('masks matching keys case-insensitively', () => {
    expect(redactBody({ Password: 'hunter2', ok: 1 }, redaction))
      .toEqual({ Password: 'XXX', ok: 1 });
  });

  it('recurses into nested objects and arrays', () => {
    expect(redactBody({ a: [{ token: 't' }] }, redaction))
      .toEqual({ a: [{ token: 'XXX' }] });
  });

  it('stops at the configured depth', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(JSON.stringify(redactBody(deep, redaction))).toContain('MaxDepth');
  });

  it('returns primitives and null unchanged', () => {
    expect(redactBody('plain', redaction)).toBe('plain');
    expect(redactBody(null, redaction)).toBeNull();
    expect(redactBody(42, redaction)).toBe(42);
  });
});

describe('serializeBody', () => {
  it('returns undefined for undefined', () => {
    expect(serializeBody(undefined, 20)).toBeUndefined();
  });

  it('passes short strings through', () => {
    expect(serializeBody('short', 20)).toBe('short');
  });

  it('truncates past the limit and says so', () => {
    const result = serializeBody('x'.repeat(50), 20);
    expect(result).toContain('max 20 chars');
    expect(result?.startsWith('x'.repeat(20))).toBe(true);
  });

  it('reports unserializable input rather than throwing', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(serializeBody(circular, 20)).toBe('[Unserializable]');
  });
});

describe('redactAndSerialize', () => {
  it('redacts before serializing', () => {
    expect(redactAndSerialize({ token: 'secret' }, redaction)).toContain('XXX');
  });

  it('never leaks a redacted value into the output', () => {
    expect(redactAndSerialize({ password: 'hunter2' }, redaction)).not.toContain('hunter2');
  });
});
```

Create `src/core/redaction/serializers.spec.ts`:

```typescript
import { sanitizeHeaders, httpLogLevel } from './serializers';
import type { IncomingMessage, ServerResponse } from 'node:http';

describe('sanitizeHeaders', () => {
  it('masks known sensitive headers case-insensitively', () => {
    const out = sanitizeHeaders({ Authorization: 'Bearer x', 'x-api-key': 'k', accept: 'json' }, 'XXX');
    expect(out).toEqual({ Authorization: 'XXX', 'x-api-key': 'XXX', accept: 'json' });
  });

  it('leaves an empty header bag empty', () => {
    expect(sanitizeHeaders({}, 'XXX')).toEqual({});
  });
});

describe('httpLogLevel', () => {
  const req = {} as IncomingMessage;
  const res = (statusCode: number) => ({ statusCode }) as ServerResponse;

  it.each([
    [200, 'info'],
    [301, 'silent'],
    [404, 'warn'],
    [500, 'error'],
  ])('maps %i to %s', (status, expected) => {
    expect(httpLogLevel(req, res(status))).toBe(expected);
  });

  it('reports error when an error is present regardless of status', () => {
    expect(httpLogLevel(req, res(200), new Error('boom'))).toBe('error');
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/core/redaction/`
Expected: PASS, 12 tests. If any fail, the move altered behavior — revert and redo the move verbatim.

- [ ] **Step 5: Update the root barrel's import paths**

In `src/index.ts`, repoint the redaction exports at `./core/redaction/redact`. Leave every other export alone.

- [ ] **Step 6: Verify the whole build still compiles**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move redaction and serializers into core, with tests

These are pure, framework-independent, and security-relevant, and had no
test coverage at all. Moved verbatim; src/logging/ keeps re-export shims
so the untouched Nest files still compile."
```

---

### Task 7: Logger interface

**Files:**
- Create: `src/core/logger/types.ts`, `src/core/logger/noop.ts`, `src/core/logger/console.ts`
- Test: `src/core/logger/console.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ObsLogger` interface, `noopLogger: ObsLogger`, `createConsoleLogger(level: string): ObsLogger`. Consumed by Task 10 and by the future `./pino` binding.

- [ ] **Step 1: Write the failing test**

Create `src/core/logger/console.spec.ts`:

```typescript
import { createConsoleLogger } from './console';
import { noopLogger } from './noop';

describe('noopLogger', () => {
  it('accepts every method without throwing', () => {
    expect(() => {
      noopLogger.debug('a');
      noopLogger.info({ a: 1 }, 'b');
      noopLogger.warn('c');
      noopLogger.error('d');
      noopLogger.child({ x: 1 }).info('e');
    }).not.toThrow();
  });

  it('returns a logger from child', () => {
    expect(typeof noopLogger.child({}).info).toBe('function');
  });
});

describe('createConsoleLogger', () => {
  let written: string[];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    written = [];
    spy = jest.spyOn(console, 'log').mockImplementation((line: unknown) => {
      written.push(String(line));
    });
  });

  afterEach(() => spy.mockRestore());

  it('suppresses messages below the configured level', () => {
    createConsoleLogger('warn').info('hidden');
    expect(written).toEqual([]);
  });

  it('emits messages at or above the configured level', () => {
    createConsoleLogger('warn').warn('shown');
    expect(written.join('')).toContain('shown');
  });

  it('merges child bindings into the output', () => {
    createConsoleLogger('info').child({ svc: 'api' }).info('hello');
    const line = written.join('');
    expect(line).toContain('svc');
    expect(line).toContain('hello');
  });

  it('accepts an object as the first argument', () => {
    createConsoleLogger('info').info({ event: 'started' });
    expect(written.join('')).toContain('started');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/logger/`
Expected: FAIL — `Cannot find module './console'`.

- [ ] **Step 3: Implement the interface and both bindings**

Create `src/core/logger/types.ts`:

```typescript
export interface ObsLogger {
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  child(bindings: object): ObsLogger;
}
```

Create `src/core/logger/noop.ts`:

```typescript
import type { ObsLogger } from './types';

const noop = (): void => undefined;

export const noopLogger: ObsLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => noopLogger,
};
```

Create `src/core/logger/console.ts`:

```typescript
import type { ObsLogger } from './types';

const RANK: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: 100 };

export const createConsoleLogger = (level = 'info', bindings: object = {}): ObsLogger => {
  const threshold = RANK[level] ?? RANK['info'];

  const emit = (at: string, obj: object | string, msg?: string): void => {
    if ((RANK[at] ?? 0) < (threshold as number)) return;
    const payload = typeof obj === 'string' ? { msg: obj } : { ...obj, ...(msg ? { msg } : {}) };
    console.log(JSON.stringify({ level: at, ...bindings, ...payload }));
  };

  return {
    debug: (o, m) => emit('debug', o, m),
    info: (o, m) => emit('info', o, m),
    warn: (o, m) => emit('warn', o, m),
    error: (o, m) => emit('error', o, m),
    child: (extra) => createConsoleLogger(level, { ...bindings, ...extra }),
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/core/logger/`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/logger/
git commit -m "feat(core): add pluggable ObsLogger interface with noop and console bindings

Lets the package log without pino in the dependency tree. The pino
binding moves behind a ./pino subpath export in a later stage."
```

---

### Task 8: Lazy telemetry handles and span helpers

**Files:**
- Create: `src/core/telemetry/handles.ts`, `src/core/telemetry/spans.ts`
- Test: `src/core/telemetry/spans.spec.ts`

**Interfaces:**
- Consumes: `defineConfig` (Task 4).
- Produces: `setTelemetryConfig(cfg)`, `getTracer()`, `getMeter()`, `resetTelemetryHandles()`, `withSpan(name, fn, attributes?)`, `getRequestContext()`. Consumed by Tasks 9, 10, and 18.

Two bugs from the spec are fixed here. P5a: `src/tracing/tracer.ts:10-14` resolves the service name at import time, so import order decides it. P5b: `getRequestContext` at `src/tracing/tracer.ts:38` starts a span it never ends when no span is active — one leaked span per call.

- [ ] **Step 1: Add the test-only SDK dependency**

```bash
npm install --save-dev @opentelemetry/sdk-trace-base
```

`InMemorySpanExporter` lives there. It is a devDependency only — core still imports nothing but `@opentelemetry/api` at runtime.

- [ ] **Step 2: Write the failing test**

Create `src/core/telemetry/spans.spec.ts`:

```typescript
import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { withSpan, getRequestContext } from './spans';
import { resetTelemetryHandles } from './handles';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

beforeEach(() => {
  exporter.reset();
  resetTelemetryHandles();
});

describe('withSpan', () => {
  it('returns the callback result', async () => {
    await expect(withSpan('op', async () => 42)).resolves.toBe(42);
  });

  it('ends the span on success', async () => {
    await withSpan('op', async () => 1);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('op');
  });

  it('rethrows, records the exception, and sets ERROR status', async () => {
    await expect(withSpan('bad', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const span = exporter.getFinishedSpans()[0];
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.status.message).toBe('boom');
    expect(span?.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('ends the span even when the callback throws', async () => {
    await expect(withSpan('bad', async () => { throw new Error('x'); })).rejects.toThrow();
    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it('applies the supplied attributes', async () => {
    await withSpan('op', async () => 1, { 'user.id': '7' });
    expect(exporter.getFinishedSpans()[0]?.attributes).toMatchObject({ 'user.id': '7' });
  });

  it('nests a child span under an active parent', async () => {
    await withSpan('parent', async () => { await withSpan('child', async () => 1); });
    const [child, parent] = exporter.getFinishedSpans();
    expect(child?.name).toBe('child');
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });
});

describe('getRequestContext', () => {
  it('returns undefined when no span is active', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('does not leak a span when no span is active', () => {
    getRequestContext();
    getRequestContext();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it('returns the ids of the active span', async () => {
    await withSpan('op', async () => {
      const ctx = getRequestContext();
      const active = trace.getActiveSpan()?.spanContext();
      expect(ctx?.traceId).toBe(active?.traceId);
      expect(ctx?.spanId).toBe(active?.spanId);
    });
  });
});
```

If `parentSpanContext` is not present on this SDK version, assert `child?.parentSpanId` instead — check the installed `@opentelemetry/sdk-trace-base` typings before implementing.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/core/telemetry/`
Expected: FAIL — `Cannot find module './spans'`.

- [ ] **Step 4: Implement lazy handles**

Create `src/core/telemetry/handles.ts`:

```typescript
import { trace, metrics, type Meter, type Tracer } from '@opentelemetry/api';
import { defineConfig } from '../config/define-config';
import type { ObservabilityConfig } from '../config/types';

let config: ObservabilityConfig | undefined;
let cached: { tracer: Tracer; meter: Meter } | undefined;

/** Called by the bootstrap so the tracer carries the resolved service name. */
export const setTelemetryConfig = (next: ObservabilityConfig): void => {
  config = next;
  cached = undefined;
};

/** Test seam — drops the memoized handles so a new provider takes effect. */
export const resetTelemetryHandles = (): void => {
  cached = undefined;
};

const handles = (): { tracer: Tracer; meter: Meter } => {
  if (cached) return cached;
  const { name, version } = (config ??= defineConfig()).service;
  cached = { tracer: trace.getTracer(name, version), meter: metrics.getMeter(name, version) };
  return cached;
};

export const getTracer = (): Tracer => handles().tracer;
export const getMeter = (): Meter => handles().meter;
```

Resolution is deferred to first use, so the service name no longer depends on import order.

- [ ] **Step 5: Implement the span helpers**

Create `src/core/telemetry/spans.ts`:

```typescript
import { trace, SpanStatusCode, type Attributes, type Span } from '@opentelemetry/api';
import { getTracer } from './handles';

export const withSpan = async <T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> =>
  getTracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      const error = err as Error;
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });

/** Returns undefined when no span is active. Previously this started an
 *  orphan span that was never ended, leaking one span per call. */
export const getRequestContext = (): { traceId: string; spanId: string } | undefined => {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx ? { traceId: ctx.traceId, spanId: ctx.spanId } : undefined;
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest src/core/telemetry/`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add src/core/telemetry/ package.json package-lock.json
git commit -m "feat(core): resolve tracer and meter lazily, stop leaking spans

The tracer and meter were module-level singletons built at import time, so
import order decided the service name. getRequestContext started a span it
never ended whenever no span was active; it now returns undefined."
```

---

### Task 9: Telemetry class

**Files:**
- Create: `src/core/telemetry/telemetry.ts`
- Test: `src/core/telemetry/telemetry.spec.ts`

**Interfaces:**
- Consumes: `getMeter`, `withSpan`, `getRequestContext` (Task 8).
- Produces: `class Telemetry` with `withSpan`, `counter`, `histogram`, `increment`, `getContext`. Consumed by Task 10; the Stage 3 Nest adapter subclasses it with `@Injectable()`.

This is `src/tracing/telemetry.service.ts` with the `@Injectable()` decorator removed and the meter read through `getMeter()` instead of a module-scope binding, so core carries no Nest dependency.

- [ ] **Step 1: Write the failing test**

Create `src/core/telemetry/telemetry.spec.ts`:

```typescript
import { Telemetry } from './telemetry';

describe('Telemetry', () => {
  it('returns the same counter instance for the same name', () => {
    const t = new Telemetry();
    expect(t.counter('a')).toBe(t.counter('a'));
  });

  it('returns different counters for different names', () => {
    const t = new Telemetry();
    expect(t.counter('a')).not.toBe(t.counter('b'));
  });

  it('caches histograms the same way', () => {
    const t = new Telemetry();
    expect(t.histogram('h')).toBe(t.histogram('h'));
  });

  it('keeps counter and histogram caches separate', () => {
    const t = new Telemetry();
    const counter = t.counter('same');
    const histogram = t.histogram('same');
    expect(counter).not.toBe(histogram);
  });

  it('increments through the cached counter without throwing', () => {
    const t = new Telemetry();
    expect(() => t.increment('requests', { route: '/a' })).not.toThrow();
    expect(() => t.increment('requests', undefined, 5)).not.toThrow();
  });

  it('delegates withSpan and returns the callback result', async () => {
    await expect(new Telemetry().withSpan('op', async () => 'done')).resolves.toBe('done');
  });

  it('returns undefined from getContext with no active span', () => {
    expect(new Telemetry().getContext()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/telemetry/telemetry.spec.ts`
Expected: FAIL — `Cannot find module './telemetry'`.

- [ ] **Step 3: Implement the class**

Create `src/core/telemetry/telemetry.ts`:

```typescript
import type { Attributes, Counter, Histogram, Span } from '@opentelemetry/api';
import { getMeter } from './handles';
import { getRequestContext, withSpan } from './spans';

export class Telemetry {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  withSpan<T>(name: string, fn: (span: Span) => Promise<T>, attributes?: Attributes): Promise<T> {
    return withSpan(name, fn, attributes);
  }

  counter(name: string, description?: string): Counter {
    const existing = this.counters.get(name);
    if (existing) return existing;

    const created = getMeter().createCounter(name, { description });
    this.counters.set(name, created);
    return created;
  }

  histogram(name: string, description?: string, unit?: string): Histogram {
    const existing = this.histograms.get(name);
    if (existing) return existing;

    const created = getMeter().createHistogram(name, { description, unit });
    this.histograms.set(name, created);
    return created;
  }

  increment(name: string, attributes?: Attributes, value = 1): void {
    this.counter(name).add(value, attributes);
  }

  getContext(): { traceId: string; spanId: string } | undefined {
    return getRequestContext();
  }
}
```

`getContext` drops the `name` parameter the old `TelemetryService` took — it was only used to name the orphan span that Task 8 removed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/core/telemetry/telemetry.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/telemetry/telemetry.ts src/core/telemetry/telemetry.spec.ts
git commit -m "feat(core): add undecorated Telemetry class

Same counter and histogram caching as TelemetryService, without the Nest
@Injectable decorator, so core stays framework-free. The Nest adapter
subclasses it in a later stage."
```

---

### Task 10: Core barrel

**Files:**
- Create: `src/core/index.ts`
- Delete: `src/core/smoke.spec.ts` (Task 1's placeholder — real tests now exist)
- Test: `src/core/index.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces: the public surface of the `"."` entry point. Consumed by Task 19 and by the Stage 3 and 4 plans.

- [ ] **Step 1: Write the failing test**

Create `src/core/index.spec.ts`:

```typescript
import * as core from './index';

describe('core barrel', () => {
  it('exports the documented surface', () => {
    for (const name of [
      'defineConfig', 'createDiagnostics', 'noopLogger', 'createConsoleLogger',
      'getTracer', 'getMeter', 'setTelemetryConfig', 'withSpan',
      'getRequestContext', 'Telemetry', 'redactBody', 'serializeBody',
      'redactAndSerialize', 'buildSerializers', 'sanitizeHeaders',
      'httpLogLevel', 'storeCapturedBody', 'readCapturedBody',
    ]) {
      expect(core).toHaveProperty(name);
    }
  });

  it('pulls in no framework or logging packages', () => {
    const loaded = Object.keys(require.cache).join('|');
    for (const forbidden of ['node_modules/@nestjs', 'node_modules/pino', 'node_modules/nestjs-pino', 'node_modules/axios']) {
      expect(loaded).not.toContain(forbidden);
    }
  });
});
```

The second test is the one that matters — it is the executable form of the "core depends on nothing but `@opentelemetry/api`" constraint, and it will catch an accidental import in review.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/index.spec.ts`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Write the barrel**

Create `src/core/index.ts`:

```typescript
export { defineConfig } from './config/define-config';
export { defaults, DEFAULT_REDACTION_KEYS } from './config/defaults';
export { fromEnv, isTrue, commaStringToList, commaStringToLowerSet, intFromEnv } from './config/env';
export { deepMerge } from './config/merge';
export type {
  ObservabilityConfig, ObservabilityConfigInput, DiagnosticLevel,
  LoggingConfig, RedactionConfig, ServiceConfig,
  TracesConfig, MetricsConfig, LogsConfig,
} from './config/types';

export { createDiagnostics } from './diagnostics';
export type { Diagnostics, DiagnosticSink } from './diagnostics';

export { noopLogger } from './logger/noop';
export { createConsoleLogger } from './logger/console';
export type { ObsLogger } from './logger/types';

export { getTracer, getMeter, setTelemetryConfig, resetTelemetryHandles } from './telemetry/handles';
export { withSpan, getRequestContext } from './telemetry/spans';
export { Telemetry } from './telemetry/telemetry';

export { redactBody, serializeBody, redactAndSerialize } from './redaction/redact';
export { buildSerializers, sanitizeHeaders, httpLogLevel } from './redaction/serializers';
export { storeCapturedBody, readCapturedBody } from './redaction/body-capture';
```

- [ ] **Step 4: Delete the placeholder smoke test**

```bash
git rm src/core/smoke.spec.ts
```

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add the core barrel with a dependency-isolation test

The barrel is the '.' entry point. Its test asserts that importing it
loads no @nestjs, pino, or axios module, which is the executable form of
the core dependency constraint."
```

---

### Task 11: pnpm-aware dependency resolution

**Files:**
- Create: `src/node/resolve.ts`
- Create: `test/fixtures/app/node_modules/fixture-lib/package.json`, `test/fixtures/app/node_modules/fixture-lib/index.js`
- Test: `src/node/resolve.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolutionPaths(): string[]`, `canResolve(id: string, paths?: string[]): boolean`, `requireOptional<T>(id: string, paths?: string[]): T | undefined`. Consumed by Tasks 14, 15, 16.

This is a correctness requirement, not an optimization. `require.resolve(id)` called from inside the library resolves relative to the **library's** location. Under pnpm's strict non-hoisted layout — which the existing consumers use — the library cannot see the application's dependencies that way, so every `requires` gate would report missing and no instrumentation would ever load.

- [ ] **Step 1: Create the fixture package**

`test/fixtures/app/node_modules/fixture-lib/package.json`:

```json
{ "name": "fixture-lib", "version": "1.0.0", "main": "index.js" }
```

`test/fixtures/app/node_modules/fixture-lib/index.js`:

```javascript
module.exports = { marker: 'fixture-lib' };
```

This fixture stands in for "a dependency the consuming app has but the library does not". `modulePathIgnorePatterns` in Task 1 already keeps jest from treating it as a test root.

- [ ] **Step 2: Write the failing test**

Create `src/node/resolve.spec.ts`:

```typescript
import { join } from 'node:path';
import { resolutionPaths, canResolve, requireOptional } from './resolve';

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
```

The second `canResolve` test is the regression guard: it fails if someone "simplifies" the implementation back to a bare `require.resolve(id)`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/node/resolve.spec.ts`
Expected: FAIL — `Cannot find module './resolve'`.

- [ ] **Step 4: Implement the resolver**

Create `src/node/resolve.ts`:

```typescript
/**
 * Optional-peer resolution.
 *
 * require.resolve(id) from inside this library searches relative to THIS
 * file. Under pnpm's non-hoisted node_modules the consuming application's
 * dependencies are not reachable that way, so every lookup must also search
 * from the application's perspective.
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

export const requireOptional = <T>(id: string, paths: string[] = resolutionPaths()): T | undefined => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(require.resolve(id, { paths })) as T;
  } catch {
    return undefined;
  }
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/node/resolve.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/node/resolve.ts src/node/resolve.spec.ts test/fixtures/
git commit -m "feat(node): resolve optional peers from the application's paths

A bare require.resolve from inside the library searches the library's own
node_modules. Under pnpm's non-hoisted layout that never sees the consuming
app's dependencies, so every optional-peer gate would report missing. Search
from process.cwd() and require.main.paths as well."
```

---

### Task 12: Instrumentation descriptor types and catalog

**Files:**
- Create: `src/node/instrumentations/types.ts`, `src/node/instrumentations/catalog.ts`
- Test: `src/node/instrumentations/catalog.spec.ts`

**Interfaces:**
- Consumes: `ObservabilityConfig` (Task 2).
- Produces: `InstrumentationDescriptor`, `InstrumentationEntry`, `defaultCatalog(cfg): InstrumentationDescriptor[]`. Consumed by Tasks 13 and 14.

- [ ] **Step 1: Write the failing test**

Create `src/node/instrumentations/catalog.spec.ts`:

```typescript
import { defaultCatalog } from './catalog';
import { defineConfig } from '../../core/config/define-config';

const cfg = defineConfig({}, {});

describe('defaultCatalog', () => {
  it('gives every descriptor a unique name', () => {
    const names = defaultCatalog(cfg).map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('points every descriptor at an @opentelemetry instrumentation package', () => {
    for (const d of defaultCatalog(cfg)) {
      expect(d.module).toMatch(/^@opentelemetry\/instrumentation-/);
    }
  });

  it('includes the instrumentations the current package hardcodes', () => {
    const names = defaultCatalog(cfg).map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['http', 'express', 'nestjs', 'kafkajs', 'typeorm']));
  });

  it('gates every descriptor except http on a host library', () => {
    for (const d of defaultCatalog(cfg)) {
      if (d.name === 'http' || d.name === 'fs') continue;
      expect(typeof d.requires).toBe('string');
    }
  });

  it('disables fs by default', () => {
    expect(defaultCatalog(cfg).find((d) => d.name === 'fs')?.enabled).toBe(false);
  });

  it('builds an http hook that ignores the configured routes', () => {
    const http = defaultCatalog(defineConfig({ traces: { ignoreRoutes: ['/health'] } }, {}))
      .find((d) => d.name === 'http');
    const hook = http?.config?.['ignoreIncomingRequestHook'] as (req: { url?: string }) => boolean;
    expect(hook({ url: '/health' })).toBe(true);
    expect(hook({ url: '/health-check/deep' })).toBe(true);
    expect(hook({ url: '/orders' })).toBe(false);
    expect(hook({})).toBe(false);
  });

  it('describes express layer filtering without importing the express package', () => {
    const express = defaultCatalog(cfg).find((d) => d.name === 'express');
    expect(express?.config?.['ignoreLayersType']).toEqual(['middleware']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/node/instrumentations/catalog.spec.ts`
Expected: FAIL — `Cannot find module './catalog'`.

- [ ] **Step 3: Implement the types**

Create `src/node/instrumentations/types.ts`:

```typescript
import type { Instrumentation } from '../../core/config/instrumentation-shim';

export interface InstrumentationDescriptor {
  /** Stable key used for overrides and env allow/deny lists, e.g. 'typeorm'. */
  name: string;
  /** Instrumentation package to load, e.g. '@opentelemetry/instrumentation-typeorm'. */
  module: string;
  /** Named export to construct. Falls back to default, then the first constructor. */
  export?: string;
  /** The library being instrumented, e.g. 'typeorm'. Absent means always applicable. */
  requires?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  /** Set by the merge step, never by consumers: true when this descriptor was named
   *  in user config or OTEL_INSTRUMENTATIONS. Drives the missing-package log level. */
  explicit?: boolean;
}

export type InstrumentationEntry =
  | boolean
  | Partial<InstrumentationDescriptor>
  | Instrumentation;
```

- [ ] **Step 4: Implement the catalog**

Create `src/node/instrumentations/catalog.ts`:

```typescript
import type { ObservabilityConfig } from '../../core/config/types';
import type { InstrumentationDescriptor } from './types';

const ignoreBy = (routes: string[]) => (req: { url?: string }): boolean => {
  const url = req.url ?? '';
  return routes.some((route) => url.startsWith(route));
};

export const defaultCatalog = (cfg: ObservabilityConfig): InstrumentationDescriptor[] => [
  {
    name: 'http',
    module: '@opentelemetry/instrumentation-http',
    config: { ignoreIncomingRequestHook: ignoreBy(cfg.traces.ignoreRoutes) },
  },
  {
    name: 'express',
    module: '@opentelemetry/instrumentation-express',
    requires: 'express',
    // String literal rather than the ExpressLayerType enum, so describing the
    // instrumentation does not require importing its package.
    config: { ignoreLayersType: ['middleware'] },
  },
  { name: 'nestjs', module: '@opentelemetry/instrumentation-nestjs-core', requires: '@nestjs/core' },
  { name: 'kafkajs', module: '@opentelemetry/instrumentation-kafkajs', requires: 'kafkajs' },
  {
    name: 'typeorm',
    module: '@opentelemetry/instrumentation-typeorm',
    requires: 'typeorm',
    config: { enableInternalInstrumentation: true, enhancedDatabaseReporting: true },
  },
  { name: 'pg', module: '@opentelemetry/instrumentation-pg', requires: 'pg' },
  { name: 'ioredis', module: '@opentelemetry/instrumentation-ioredis', requires: 'ioredis' },
  { name: 'mongodb', module: '@opentelemetry/instrumentation-mongodb', requires: 'mongodb' },
  { name: 'graphql', module: '@opentelemetry/instrumentation-graphql', requires: 'graphql' },
  { name: 'fs', module: '@opentelemetry/instrumentation-fs', enabled: false },
];

export const isCatalogName = (name: string, cfg: ObservabilityConfig): boolean =>
  defaultCatalog(cfg).some((d) => d.name === name);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/node/instrumentations/catalog.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/node/instrumentations/
git commit -m "feat(node): describe instrumentations as data instead of imports

The catalog names packages as strings and gates each on the library it
instruments, so nothing is loaded to describe it. Replaces the static
imports at src/bootstrap/instrumentations.ts:4-5 whose enable flags were
checked only after the import had already happened."
```

---

### Task 13: Merge user overrides into the catalog

**Files:**
- Create: `src/node/instrumentations/merge.ts`
- Test: `src/node/instrumentations/merge.spec.ts`

**Interfaces:**
- Consumes: `defaultCatalog` (Task 12), `deepMerge` (Task 2).
- Produces: `mergeInstrumentations(catalog, overrides): { descriptors: InstrumentationDescriptor[]; instances: Instrumentation[] }`. Consumed by Task 14.

Live `Instrumentation` instances are split out here rather than in the resolver, so the resolver only ever deals with descriptors.

- [ ] **Step 1: Write the failing test**

Create `src/node/instrumentations/merge.spec.ts`:

```typescript
import { mergeInstrumentations } from './merge';
import type { InstrumentationDescriptor } from './types';

const catalog: InstrumentationDescriptor[] = [
  { name: 'http', module: '@opentelemetry/instrumentation-http', config: { a: 1 } },
  { name: 'typeorm', module: '@opentelemetry/instrumentation-typeorm', requires: 'typeorm' },
];

describe('mergeInstrumentations', () => {
  it('returns the catalog unchanged when there are no overrides', () => {
    expect(mergeInstrumentations(catalog, {}).descriptors).toHaveLength(2);
  });

  it('marks catalog defaults as not explicit', () => {
    const http = mergeInstrumentations(catalog, {}).descriptors.find((d) => d.name === 'http');
    expect(http?.explicit).toBeFalsy();
  });

  it('disables a built-in when the override is false', () => {
    const { descriptors } = mergeInstrumentations(catalog, { typeorm: false });
    expect(descriptors.find((d) => d.name === 'typeorm')?.enabled).toBe(false);
  });

  it('patches a built-in config without dropping its other fields', () => {
    const { descriptors } = mergeInstrumentations(catalog, { http: { config: { b: 2 } } });
    const http = descriptors.find((d) => d.name === 'http');
    expect(http?.module).toBe('@opentelemetry/instrumentation-http');
    expect(http?.config).toEqual({ a: 1, b: 2 });
  });

  it('marks a patched built-in as explicit', () => {
    const { descriptors } = mergeInstrumentations(catalog, { http: { config: { b: 2 } } });
    expect(descriptors.find((d) => d.name === 'http')?.explicit).toBe(true);
  });

  it('adds a descriptor that is not in the catalog', () => {
    const { descriptors } = mergeInstrumentations(catalog, {
      amqplib: { module: '@opentelemetry/instrumentation-amqplib', requires: 'amqplib' },
    });
    const added = descriptors.find((d) => d.name === 'amqplib');
    expect(added?.module).toBe('@opentelemetry/instrumentation-amqplib');
    expect(added?.explicit).toBe(true);
  });

  it('separates live instrumentation instances from descriptors', () => {
    const instance = { instrumentationName: 'x', instrumentationVersion: '1', enable() {}, disable() {} };
    const { descriptors, instances } = mergeInstrumentations(catalog, { custom: instance });
    expect(instances).toEqual([instance]);
    expect(descriptors.find((d) => d.name === 'custom')).toBeUndefined();
  });

  it('treats an override of true as an explicit enable', () => {
    const { descriptors } = mergeInstrumentations(catalog, { typeorm: true });
    const typeorm = descriptors.find((d) => d.name === 'typeorm');
    expect(typeorm?.enabled).toBe(true);
    expect(typeorm?.explicit).toBe(true);
  });

  it('ignores an added entry that supplies no module', () => {
    expect(mergeInstrumentations(catalog, { bogus: { requires: 'x' } }).descriptors)
      .toHaveLength(2);
  });

  it('does not mutate the catalog it is given', () => {
    mergeInstrumentations(catalog, { http: { config: { b: 2 } } });
    expect(catalog[0]?.config).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/node/instrumentations/merge.spec.ts`
Expected: FAIL — `Cannot find module './merge'`.

- [ ] **Step 3: Implement the merge**

Create `src/node/instrumentations/merge.ts`:

```typescript
import { deepMerge } from '../../core/config/merge';
import type { Instrumentation } from '../../core/config/instrumentation-shim';
import type { InstrumentationDescriptor } from './types';

const isInstance = (value: unknown): value is Instrumentation =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Instrumentation).enable === 'function' &&
  typeof (value as Instrumentation).disable === 'function';

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
      byName.set(name, { ...deepMerge(existing, patch), name, explicit: true });
      continue;
    }

    // A new descriptor must name a module; there is nothing to load otherwise.
    if (typeof patch.module !== 'string') continue;
    byName.set(name, { ...patch, name, module: patch.module, explicit: true });
  }

  return { descriptors: [...byName.values()], instances };
};
```

`{ ...deepMerge(existing, patch), name }` re-pins the name so a patch cannot rename a catalog entry out from under its key. A `false` or `true` override for a name that is not in the catalog is dropped, since there is no module to load.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/node/instrumentations/merge.spec.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/node/instrumentations/merge.ts src/node/instrumentations/merge.spec.ts
git commit -m "feat(node): merge instrumentation overrides by name

Supports patching a built-in, disabling with false, declaring a new
descriptor, and passing a constructed instance straight through. Sets the
explicit flag that decides the missing-package log level."
```

---

### Task 14: Resolve instrumentations through both gates

**Files:**
- Create: `src/node/instrumentations/resolve.ts`
- Test: `src/node/instrumentations/resolve.spec.ts`

**Interfaces:**
- Consumes: `canResolve`, `requireOptional` (Task 11); descriptor types (Task 12); `Diagnostics` (Task 5).
- Produces: `resolveInstrumentations(descriptors, diag, deps?): Instrumentation[]`, where `deps` is an injectable `{ canResolve, requireOptional }` seam for tests. Consumed by Task 18.

This is the centerpiece of the whole plan. Two independent gates: is the instrumented library present, and is the instrumentation package present. Neither ever throws — a missing instrumentation degrades detail but must not stop the application.

- [ ] **Step 1: Write the failing test**

Create `src/node/instrumentations/resolve.spec.ts`:

```typescript
import { resolveInstrumentations } from './resolve';
import type { InstrumentationDescriptor } from './types';
import type { Diagnostics } from '../../core/diagnostics';

class FakeInstrumentation {
  constructor(public readonly config: Record<string, unknown>) {}
  instrumentationName = 'fake';
  instrumentationVersion = '1.0.0';
  enable(): void {}
  disable(): void {}
}

const recorder = () => {
  const lines: Array<[string, string]> = [];
  const diag = {
    log: (level: string, msg: string) => { lines.push([level, msg]); },
    error: (m: string) => { lines.push(['error', m]); },
    warn: (m: string) => { lines.push(['warn', m]); },
    info: (m: string) => { lines.push(['info', m]); },
    debug: (m: string) => { lines.push(['debug', m]); },
  } as unknown as Diagnostics;
  return { lines, diag };
};

const deps = (present: string[], exports: Record<string, unknown> = {}) => ({
  canResolve: (id: string) => present.includes(id),
  requireOptional: (id: string) => exports[id] ?? { FakeInstrumentation },
});

const d = (over: Partial<InstrumentationDescriptor>): InstrumentationDescriptor =>
  ({ name: 'x', module: 'mod-x', ...over });

describe('resolveInstrumentations', () => {
  it('constructs an instrumentation when both gates pass', () => {
    const { diag } = recorder();
    const result = resolveInstrumentations(
      [d({ export: 'FakeInstrumentation' })], diag, deps(['mod-x']),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(FakeInstrumentation);
  });

  it('passes the descriptor config to the constructor', () => {
    const { diag } = recorder();
    const [made] = resolveInstrumentations(
      [d({ export: 'FakeInstrumentation', config: { a: 1 } })], diag, deps(['mod-x']),
    );
    expect((made as unknown as FakeInstrumentation).config).toEqual({ a: 1 });
  });

  it('skips a descriptor that is explicitly disabled', () => {
    const { diag } = recorder();
    expect(resolveInstrumentations([d({ enabled: false })], diag, deps(['mod-x']))).toHaveLength(0);
  });

  it('skips when the instrumented library is absent', () => {
    const { diag } = recorder();
    const result = resolveInstrumentations(
      [d({ requires: 'typeorm' })], diag, deps(['mod-x']),
    );
    expect(result).toHaveLength(0);
  });

  it('skips when the instrumentation package is absent', () => {
    const { diag } = recorder();
    expect(resolveInstrumentations([d({})], diag, deps([]))).toHaveLength(0);
  });

  it('logs at debug when a defaulted descriptor is unavailable', () => {
    const { lines, diag } = recorder();
    resolveInstrumentations([d({ requires: 'typeorm' })], diag, deps([]));
    expect(lines.every(([level]) => level === 'debug')).toBe(true);
  });

  it('logs at warn when an explicit descriptor is unavailable', () => {
    const { lines, diag } = recorder();
    resolveInstrumentations([d({ requires: 'typeorm', explicit: true })], diag, deps([]));
    expect(lines.some(([level]) => level === 'warn')).toBe(true);
  });

  it('names the package to install in the message', () => {
    const { lines, diag } = recorder();
    resolveInstrumentations([d({ module: '@otel/thing', explicit: true })], diag, deps([]));
    expect(lines.map(([, msg]) => msg).join(' ')).toContain('@otel/thing');
  });

  it('never throws when a package is missing', () => {
    const { diag } = recorder();
    expect(() => resolveInstrumentations([d({})], diag, deps([]))).not.toThrow();
  });

  it('skips a module that exports no usable constructor', () => {
    const { lines, diag } = recorder();
    const result = resolveInstrumentations(
      [d({ export: 'Missing' })], diag,
      { canResolve: () => true, requireOptional: () => ({ Missing: 'not a function' }) },
    );
    expect(result).toHaveLength(0);
    expect(lines.some(([level]) => level === 'warn')).toBe(true);
  });

  it('falls back to the default export when no export name is given', () => {
    const { diag } = recorder();
    const result = resolveInstrumentations(
      [d({})], diag,
      { canResolve: () => true, requireOptional: () => ({ default: FakeInstrumentation }) },
    );
    expect(result).toHaveLength(1);
  });

  it('survives a constructor that throws and keeps going', () => {
    const { diag } = recorder();
    class Boom { constructor() { throw new Error('bad'); } }
    const result = resolveInstrumentations(
      [d({ name: 'boom', module: 'a', export: 'Boom' }), d({ name: 'ok', module: 'b', export: 'FakeInstrumentation' })],
      diag,
      { canResolve: () => true, requireOptional: (id: string) => (id === 'a' ? { Boom } : { FakeInstrumentation }) },
    );
    expect(result).toHaveLength(1);
  });

  it('resolves several descriptors in order', () => {
    const { diag } = recorder();
    const result = resolveInstrumentations(
      [d({ name: 'a', module: 'a', export: 'FakeInstrumentation' }),
       d({ name: 'b', module: 'b', export: 'FakeInstrumentation' })],
      diag,
      { canResolve: () => true, requireOptional: () => ({ FakeInstrumentation }) },
    );
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/node/instrumentations/resolve.spec.ts`
Expected: FAIL — `Cannot find module './resolve'`.

- [ ] **Step 3: Implement the resolver**

Create `src/node/instrumentations/resolve.ts`:

```typescript
import type { Instrumentation } from '../../core/config/instrumentation-shim';
import type { Diagnostics } from '../../core/diagnostics';
import { canResolve as defaultCanResolve, requireOptional as defaultRequireOptional } from '../resolve';
import type { InstrumentationDescriptor } from './types';

export interface ResolverDeps {
  canResolve: (id: string) => boolean;
  requireOptional: (id: string) => unknown;
}

type Ctor = new (config: Record<string, unknown>) => Instrumentation;

const pickConstructor = (mod: unknown, name?: string): Ctor | undefined => {
  if (typeof mod !== 'object' || mod === null) return undefined;
  const bag = mod as Record<string, unknown>;

  const candidate = name ? bag[name] : (bag['default'] ?? Object.values(bag).find((v) => typeof v === 'function'));
  return typeof candidate === 'function' ? (candidate as Ctor) : undefined;
};

export const resolveInstrumentations = (
  descriptors: InstrumentationDescriptor[],
  diag: Diagnostics,
  deps: ResolverDeps = { canResolve: defaultCanResolve, requireOptional: defaultRequireOptional },
): Instrumentation[] => {
  const out: Instrumentation[] = [];

  for (const d of descriptors) {
    if (d.enabled === false) continue;

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/node/instrumentations/resolve.spec.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/node/instrumentations/resolve.ts src/node/instrumentations/resolve.spec.ts
git commit -m "feat(node): resolve instrumentations at runtime behind two gates

An instrumentation loads only when the library it instruments and its own
package both resolve from the application's paths. Missing packages are
logged, never thrown, so a service with no typeorm simply gets no typeorm
spans instead of a crash or a mandatory dependency."
```

---

### Task 15: Trace and log exporter registry

**Files:**
- Create: `src/node/exporters/types.ts`, `src/node/exporters/signals.ts`
- Test: `src/node/exporters/signals.spec.ts`

**Interfaces:**
- Consumes: `canResolve`, `requireOptional` (Task 11); `Diagnostics` (Task 5).
- Produces: `SpanExporterSpec`, `LogExporterSpec`, `resolveTraceExporters(spec, cfg, diag, deps?)`, `resolveLogExporters(spec, cfg, diag, deps?)`. Consumed by Task 18.

Opposite failure policy from instrumentations: a missing exporter package **throws**, because it means no telemetry reaches anything and silence would hide the whole problem.

- [ ] **Step 1: Write the failing test**

Create `src/node/exporters/signals.spec.ts`:

```typescript
import { resolveTraceExporters } from './signals';
import { createDiagnostics } from '../../core/diagnostics';

const diag = createDiagnostics('none');
const noop = () => undefined;

class FakeExporter {
  constructor(public readonly opts: unknown) {}
  export = noop;
  shutdown = async () => undefined;
}

const deps = (present: string[]) => ({
  canResolve: (id: string) => present.includes(id),
  requireOptional: () => ({ OTLPTraceExporter: FakeExporter, ConsoleSpanExporter: FakeExporter }),
});

const ALL = [
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/exporter-trace-otlp-grpc',
  '@opentelemetry/exporter-trace-otlp-proto',
  '@opentelemetry/sdk-trace-base',
];

describe('resolveTraceExporters', () => {
  it('returns nothing for the none spec', () => {
    expect(resolveTraceExporters('none', {}, diag, deps(ALL))).toEqual([]);
  });

  it('builds an otlp-http exporter', () => {
    expect(resolveTraceExporters('otlp-http', {}, diag, deps(ALL))).toHaveLength(1);
  });

  it.each(['otlp-grpc', 'otlp-proto', 'console'])('builds a %s exporter', (spec) => {
    expect(resolveTraceExporters(spec, {}, diag, deps(ALL))).toHaveLength(1);
  });

  it('passes the endpoint through to the exporter options', () => {
    const [made] = resolveTraceExporters('otlp-http', { endpoint: 'http://x:4318' }, diag, deps(ALL));
    expect((made as unknown as FakeExporter).opts).toMatchObject({ url: 'http://x:4318' });
  });

  it('fans out an array spec to several exporters', () => {
    expect(resolveTraceExporters(['console', 'otlp-http'], {}, diag, deps(ALL))).toHaveLength(2);
  });

  it('passes a supplied exporter instance through untouched', () => {
    const instance = new FakeExporter({});
    expect(resolveTraceExporters(instance, {}, diag, deps(ALL))[0]).toBe(instance);
  });

  it('calls a supplied factory and uses its result', () => {
    const instance = new FakeExporter({});
    expect(resolveTraceExporters(() => instance, {}, diag, deps(ALL))[0]).toBe(instance);
  });

  it('throws when the requested exporter package is missing', () => {
    expect(() => resolveTraceExporters('otlp-grpc', {}, diag, deps([])))
      .toThrow(/@opentelemetry\/exporter-trace-otlp-grpc/);
  });

  it('throws on an unknown exporter name', () => {
    expect(() => resolveTraceExporters('carrier-pigeon', {}, diag, deps(ALL)))
      .toThrow(/carrier-pigeon/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/node/exporters/signals.spec.ts`
Expected: FAIL — `Cannot find module './signals'`.

- [ ] **Step 3: Implement the types**

Create `src/node/exporters/types.ts`:

```typescript
export type NamedExporter = 'otlp-http' | 'otlp-grpc' | 'otlp-proto' | 'console' | 'none';
export type NamedMetricExporter = NamedExporter | 'prometheus';

export type ExporterSpec<T> = NamedExporter | T | (() => T) | Array<NamedExporter | T | (() => T)>;

export interface ExporterOptions {
  endpoint?: string;
}

/** Package + named export per signal, so a missing package names itself. */
export const TRACE_EXPORTERS: Record<Exclude<NamedExporter, 'none'>, [string, string]> = {
  'otlp-http': ['@opentelemetry/exporter-trace-otlp-http', 'OTLPTraceExporter'],
  'otlp-grpc': ['@opentelemetry/exporter-trace-otlp-grpc', 'OTLPTraceExporter'],
  'otlp-proto': ['@opentelemetry/exporter-trace-otlp-proto', 'OTLPTraceExporter'],
  console: ['@opentelemetry/sdk-trace-base', 'ConsoleSpanExporter'],
};

export const LOG_EXPORTERS: Record<Exclude<NamedExporter, 'none'>, [string, string]> = {
  'otlp-http': ['@opentelemetry/exporter-logs-otlp-http', 'OTLPLogExporter'],
  'otlp-grpc': ['@opentelemetry/exporter-logs-otlp-grpc', 'OTLPLogExporter'],
  'otlp-proto': ['@opentelemetry/exporter-logs-otlp-proto', 'OTLPLogExporter'],
  console: ['@opentelemetry/sdk-logs', 'ConsoleLogRecordExporter'],
};
```

- [ ] **Step 4: Implement the resolver**

Create `src/node/exporters/signals.ts`:

```typescript
import type { Diagnostics } from '../../core/diagnostics';
import { canResolve as defaultCanResolve, requireOptional as defaultRequireOptional } from '../resolve';
import { LOG_EXPORTERS, TRACE_EXPORTERS, type ExporterOptions } from './types';

export interface ExporterDeps {
  canResolve: (id: string) => boolean;
  requireOptional: (id: string) => unknown;
}

const DEFAULT_DEPS: ExporterDeps = {
  canResolve: defaultCanResolve,
  requireOptional: defaultRequireOptional,
};

const build = (
  table: Record<string, [string, string]>,
  name: string,
  options: ExporterOptions,
  deps: ExporterDeps,
): unknown => {
  const entry = table[name];
  if (!entry) {
    throw new Error(
      `[observability] unknown exporter "${name}". Valid names: ${Object.keys(table).join(', ')}, none`,
    );
  }

  const [module, exportName] = entry;
  if (!deps.canResolve(module)) {
    throw new Error(
      `[observability] exporter "${name}" requires ${module}, which is not installed. ` +
        `Run \`npm install ${module}\`, or set the exporter to "console" or "none".`,
    );
  }

  const bag = deps.requireOptional(module) as Record<string, unknown> | undefined;
  const Ctor = bag?.[exportName];
  if (typeof Ctor !== 'function') {
    throw new Error(`[observability] ${module} does not export ${exportName}`);
  }

  // ConsoleSpanExporter takes no options; passing an empty object is harmless.
  const opts = options.endpoint ? { url: options.endpoint } : {};
  return new (Ctor as new (o: unknown) => unknown)(opts);
};

const resolveWith = (
  table: Record<string, [string, string]>,
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
```

`'console'` maps to `@opentelemetry/sdk-trace-base`, which `@opentelemetry/sdk-node` already depends on. That is what lets a bare install produce visible output with no collector running.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/node/exporters/signals.spec.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add src/node/exporters/
git commit -m "feat(node): add a trace and log exporter registry

Named exporters resolve to packages at runtime; instances and factories
pass through for vendor backends; arrays fan out to several backends. A
missing exporter package throws with the install command, because unlike a
missing instrumentation it means no telemetry reaches anything."
```

---

### Task 16: Metric reader registry

**Files:**
- Create: `src/node/exporters/metrics.ts`
- Test: `src/node/exporters/metrics.spec.ts`

**Interfaces:**
- Consumes: `ExporterDeps` (Task 15), `Diagnostics` (Task 5).
- Produces: `resolveMetricReaders(spec, options, diag, deps?): unknown[]`. Consumed by Task 18.

Metrics are separate from traces and logs because `NodeSDK` wants **readers**, not exporters. Push exporters get wrapped in a `PeriodicExportingMetricReader`; `PrometheusExporter` is already a reader and must be passed through unwrapped — wrapping it produces a reader that never serves `/metrics`.

- [ ] **Step 1: Write the failing test**

Create `src/node/exporters/metrics.spec.ts`:

```typescript
import { resolveMetricReaders } from './metrics';
import { createDiagnostics } from '../../core/diagnostics';

const diag = createDiagnostics('none');

class FakeMetricExporter { constructor(public readonly opts: unknown) {} }
class FakePeriodicReader { constructor(public readonly opts: Record<string, unknown>) {} }
class FakePrometheusExporter { constructor(public readonly opts: unknown) {} }

const MODULES: Record<string, unknown> = {
  '@opentelemetry/exporter-metrics-otlp-http': { OTLPMetricExporter: FakeMetricExporter },
  '@opentelemetry/exporter-metrics-otlp-grpc': { OTLPMetricExporter: FakeMetricExporter },
  '@opentelemetry/exporter-prometheus': { PrometheusExporter: FakePrometheusExporter },
  '@opentelemetry/sdk-metrics': {
    PeriodicExportingMetricReader: FakePeriodicReader,
    ConsoleMetricExporter: FakeMetricExporter,
  },
};

const deps = (present = Object.keys(MODULES)) => ({
  canResolve: (id: string) => present.includes(id),
  requireOptional: (id: string) => MODULES[id],
});

describe('resolveMetricReaders', () => {
  it('returns nothing for none', () => {
    expect(resolveMetricReaders('none', {}, diag, deps())).toEqual([]);
  });

  it('wraps a push exporter in a periodic reader', () => {
    const [reader] = resolveMetricReaders('otlp-http', { exportIntervalMs: 1234 }, diag, deps());
    expect(reader).toBeInstanceOf(FakePeriodicReader);
    expect((reader as FakePeriodicReader).opts['exportIntervalMillis']).toBe(1234);
    expect((reader as FakePeriodicReader).opts['exporter']).toBeInstanceOf(FakeMetricExporter);
  });

  it('passes the prometheus exporter through unwrapped', () => {
    const [reader] = resolveMetricReaders('prometheus', { port: 9999 }, diag, deps());
    expect(reader).toBeInstanceOf(FakePrometheusExporter);
    expect((reader as FakePrometheusExporter).opts).toMatchObject({ port: 9999 });
  });

  it('throws when the prometheus package is missing', () => {
    expect(() => resolveMetricReaders('prometheus', {}, diag, deps([])))
      .toThrow(/@opentelemetry\/exporter-prometheus/);
  });

  it('supports console metrics', () => {
    expect(resolveMetricReaders('console', {}, diag, deps())[0]).toBeInstanceOf(FakePeriodicReader);
  });

  it('fans out an array spec', () => {
    expect(resolveMetricReaders(['prometheus', 'otlp-http'], {}, diag, deps())).toHaveLength(2);
  });

  it('passes a supplied reader instance through', () => {
    const reader = { collect: async () => undefined };
    expect(resolveMetricReaders(reader, {}, diag, deps())[0]).toBe(reader);
  });

  it('throws on an unknown name', () => {
    expect(() => resolveMetricReaders('nope', {}, diag, deps())).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/node/exporters/metrics.spec.ts`
Expected: FAIL — `Cannot find module './metrics'`.

- [ ] **Step 3: Implement the metric reader registry**

Create `src/node/exporters/metrics.ts`:

```typescript
import type { Diagnostics } from '../../core/diagnostics';
import { canResolve as defaultCanResolve, requireOptional as defaultRequireOptional } from '../resolve';
import type { ExporterDeps } from './signals';

const DEFAULT_DEPS: ExporterDeps = {
  canResolve: defaultCanResolve,
  requireOptional: defaultRequireOptional,
};

const PUSH_EXPORTERS: Record<string, [string, string]> = {
  'otlp-http': ['@opentelemetry/exporter-metrics-otlp-http', 'OTLPMetricExporter'],
  'otlp-grpc': ['@opentelemetry/exporter-metrics-otlp-grpc', 'OTLPMetricExporter'],
  'otlp-proto': ['@opentelemetry/exporter-metrics-otlp-proto', 'OTLPMetricExporter'],
  console: ['@opentelemetry/sdk-metrics', 'ConsoleMetricExporter'],
};

const SDK_METRICS = '@opentelemetry/sdk-metrics';
const PROMETHEUS = '@opentelemetry/exporter-prometheus';

export interface MetricOptions {
  endpoint?: string;
  exportIntervalMs?: number;
  port?: number;
}

const load = (module: string, exportName: string, deps: ExporterDeps): new (o: unknown) => unknown => {
  if (!deps.canResolve(module)) {
    throw new Error(
      `[observability] metric exporter requires ${module}, which is not installed. ` +
        `Run \`npm install ${module}\`, or set metrics.exporter to "console" or "none".`,
    );
  }
  const bag = deps.requireOptional(module) as Record<string, unknown> | undefined;
  const Ctor = bag?.[exportName];
  if (typeof Ctor !== 'function') {
    throw new Error(`[observability] ${module} does not export ${exportName}`);
  }
  return Ctor as new (o: unknown) => unknown;
};

const buildNamed = (name: string, options: MetricOptions, deps: ExporterDeps): unknown => {
  // PrometheusExporter IS a MetricReader — wrapping it would stop it serving /metrics.
  if (name === 'prometheus') {
    const Ctor = load(PROMETHEUS, 'PrometheusExporter', deps);
    return new Ctor({ port: options.port ?? 9464 });
  }

  const entry = PUSH_EXPORTERS[name];
  if (!entry) {
    throw new Error(
      `[observability] unknown metric exporter "${name}". ` +
        `Valid names: ${Object.keys(PUSH_EXPORTERS).join(', ')}, prometheus, none`,
    );
  }

  const Exporter = load(entry[0], entry[1], deps);
  const Reader = load(SDK_METRICS, 'PeriodicExportingMetricReader', deps);

  return new Reader({
    exporter: new Exporter(options.endpoint ? { url: options.endpoint } : {}),
    exportIntervalMillis: options.exportIntervalMs ?? 5000,
  });
};

export const resolveMetricReaders = (
  spec: unknown,
  options: MetricOptions,
  diag: Diagnostics,
  deps: ExporterDeps = DEFAULT_DEPS,
): unknown[] => {
  if (Array.isArray(spec)) return spec.flatMap((s) => resolveMetricReaders(s, options, diag, deps));
  if (spec === 'none' || spec === undefined) return [];
  if (typeof spec === 'string') {
    const reader = buildNamed(spec, options, deps);
    diag.debug(`metric reader ${spec} ready`);
    return [reader];
  }
  if (typeof spec === 'function') return [(spec as () => unknown)()];
  if (typeof spec === 'object' && spec !== null) return [spec];

  throw new Error(`[observability] unsupported metric exporter specification: ${String(spec)}`);
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/node/exporters/metrics.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/node/exporters/metrics.ts src/node/exporters/metrics.spec.ts
git commit -m "feat(node): add metric readers including a Prometheus pull endpoint

Push exporters are wrapped in a PeriodicExportingMetricReader; the
Prometheus exporter is already a reader and is passed through unwrapped,
since wrapping it would stop it serving /metrics."
```

---

### Task 17: Shutdown hooks

**Files:**
- Create: `src/node/shutdown.ts`
- Test: `src/node/shutdown.spec.ts`
- Reference: `src/bootstrap/shutdown.ts` (deleted in Task 19)

**Interfaces:**
- Consumes: `Diagnostics` (Task 5).
- Produces: `registerShutdownHooks(sdk, diag, opts?): () => void` returning an unregister function. Consumed by Task 18.

Three problems with the current version: it logs to `console.log` unconditionally, it calls `process.exit(0)` even when shutdown failed (so a crashing flush reports success to the orchestrator), and it registers listeners with no way to remove them, which leaks handles across tests.

- [ ] **Step 1: Write the failing test**

Create `src/node/shutdown.spec.ts`:

```typescript
import { registerShutdownHooks } from './shutdown';
import { createDiagnostics } from '../core/diagnostics';

const diag = createDiagnostics('none');

describe('registerShutdownHooks', () => {
  it('registers a listener for SIGTERM and SIGINT', () => {
    const before = { term: process.listenerCount('SIGTERM'), int: process.listenerCount('SIGINT') };
    const off = registerShutdownHooks({ shutdown: async () => undefined }, diag, { exit: () => undefined });
    expect(process.listenerCount('SIGTERM')).toBe(before.term + 1);
    expect(process.listenerCount('SIGINT')).toBe(before.int + 1);
    off();
  });

  it('removes both listeners when unregistered', () => {
    const before = process.listenerCount('SIGTERM');
    registerShutdownHooks({ shutdown: async () => undefined }, diag, { exit: () => undefined })();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('shuts the sdk down and exits 0 on success', async () => {
    const codes: number[] = [];
    let shutdownCalled = false;
    const off = registerShutdownHooks(
      { shutdown: async () => { shutdownCalled = true; } },
      diag,
      { exit: (code: number) => { codes.push(code); } },
    );
    process.emit('SIGTERM');
    await new Promise((r) => setImmediate(r));
    expect(shutdownCalled).toBe(true);
    expect(codes).toEqual([0]);
    off();
  });

  it('exits non-zero when shutdown rejects', async () => {
    const codes: number[] = [];
    const off = registerShutdownHooks(
      { shutdown: async () => { throw new Error('flush failed'); } },
      diag,
      { exit: (code: number) => { codes.push(code); } },
    );
    process.emit('SIGINT');
    await new Promise((r) => setImmediate(r));
    expect(codes).toEqual([1]);
    off();
  });

  it('shuts down only once when signalled twice', async () => {
    let calls = 0;
    const off = registerShutdownHooks(
      { shutdown: async () => { calls += 1; } },
      diag,
      { exit: () => undefined },
    );
    process.emit('SIGTERM');
    process.emit('SIGTERM');
    await new Promise((r) => setImmediate(r));
    expect(calls).toBe(1);
    off();
  });
});
```

`process.emit('SIGTERM')` may not typecheck against `@types/node`'s overloads, which expect a
second signal argument. If it errors, write it as `process.emit('SIGTERM' as never)` — the runtime
behavior is what is being tested, not the signature.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/node/shutdown.spec.ts`
Expected: FAIL — `Cannot find module './shutdown'`.

- [ ] **Step 3: Implement the hooks**

Create `src/node/shutdown.ts`:

```typescript
import type { Diagnostics } from '../core/diagnostics';

export interface ShutdownTarget {
  shutdown(): Promise<void>;
}

export interface ShutdownOptions {
  /** Injected so tests do not kill the jest worker. */
  exit?: (code: number) => void;
}

const SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

export const registerShutdownHooks = (
  sdk: ShutdownTarget,
  diag: Diagnostics,
  options: ShutdownOptions = {},
): (() => void) => {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let started = false;

  const handlers = SIGNALS.map((signal) => {
    const handler = (): void => {
      if (started) return;
      started = true;

      sdk
        .shutdown()
        .then(() => {
          diag.info(`OpenTelemetry SDK shut down (${signal})`);
          exit(0);
        })
        .catch((err: unknown) => {
          diag.error(`error shutting down OpenTelemetry SDK: ${(err as Error).message}`);
          exit(1);
        });
    };

    process.on(signal, handler);
    return [signal, handler] as const;
  });

  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/node/shutdown.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/node/shutdown.ts src/node/shutdown.spec.ts
git commit -m "feat(node): harden shutdown hooks

Route logging through diagnostics instead of console.log, exit non-zero
when the flush fails rather than always reporting success, guard against a
double signal, and return an unregister function so tests do not leak
process listeners."
```

---

### Task 18: Assemble the SDK

**Files:**
- Create: `src/node/sdk.ts`, `src/node/index.ts`
- Test: `src/node/sdk.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 11–17, plus `defineConfig` and `setTelemetryConfig` from core.
- Produces: `createSdk(config, deps?): { sdk, instrumentations, traceExporters, metricReaders, logExporters }` and `startObservability(input?): SdkHandle`. Consumed by Task 19.

`createSdk` returns the resolved parts alongside the SDK so they can be asserted without starting anything.

- [ ] **Step 1: Add the SDK dev dependencies**

```bash
npm install --save-dev @opentelemetry/sdk-node @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/sdk-logs @opentelemetry/sdk-metrics
```

These stay devDependencies here; moving them to optional peers is Stage 4 packaging work.

- [ ] **Step 2: Write the failing test**

Create `src/node/sdk.spec.ts`:

```typescript
import { createSdk } from './sdk';
import { defineConfig } from '../core/config/define-config';

describe('createSdk', () => {
  it('builds a console-only pipeline with no collector configured', () => {
    const cfg = defineConfig({
      traces: { exporter: 'console' },
      metrics: { exporter: 'none' },
      logs: { exporter: 'none' },
    }, {});
    const built = createSdk(cfg);
    expect(built.traceExporters).toHaveLength(1);
    expect(built.metricReaders).toHaveLength(0);
    expect(built.logExporters).toHaveLength(0);
  });

  it('resolves no instrumentations when nothing is installed', () => {
    const cfg = defineConfig({ traces: { exporter: 'console' }, metrics: { exporter: 'none' }, logs: { exporter: 'none' } }, {});
    const built = createSdk(cfg, {
      canResolve: (id: string) => id === '@opentelemetry/sdk-trace-base',
      requireOptional: (id: string) => require(id),
    });
    expect(built.instrumentations).toHaveLength(0);
  });

  it('includes a user-supplied instrumentation instance', () => {
    const instance = { instrumentationName: 'custom', instrumentationVersion: '1', enable() {}, disable() {} };
    const cfg = defineConfig({
      traces: { exporter: 'console' }, metrics: { exporter: 'none' }, logs: { exporter: 'none' },
      instrumentations: { custom: instance },
    }, {});
    expect(createSdk(cfg).instrumentations).toContain(instance);
  });

  it('stamps the service name onto the resource', () => {
    const cfg = defineConfig({
      service: { name: 'orders-api', version: '2.1.0' },
      traces: { exporter: 'console' }, metrics: { exporter: 'none' }, logs: { exporter: 'none' },
    }, {});
    expect(createSdk(cfg).resourceAttributes).toMatchObject({
      'service.name': 'orders-api',
      'service.version': '2.1.0',
    });
  });

  it('merges custom resource attributes', () => {
    const cfg = defineConfig({
      resource: { attributes: { 'deployment.environment': 'staging' } },
      traces: { exporter: 'console' }, metrics: { exporter: 'none' }, logs: { exporter: 'none' },
    }, {});
    expect(createSdk(cfg).resourceAttributes).toMatchObject({ 'deployment.environment': 'staging' });
  });

  it('propagates an exporter error rather than starting half-configured', () => {
    const cfg = defineConfig({ traces: { exporter: 'carrier-pigeon' } }, {});
    expect(() => createSdk(cfg)).toThrow(/carrier-pigeon/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/node/sdk.spec.ts`
Expected: FAIL — `Cannot find module './sdk'`.

- [ ] **Step 4: Implement createSdk**

Create `src/node/sdk.ts`:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { createDiagnostics } from '../core/diagnostics';
import { defineConfig } from '../core/config/define-config';
import { setTelemetryConfig } from '../core/telemetry/handles';
import type { ObservabilityConfig, ObservabilityConfigInput } from '../core/config/types';
import { defaultCatalog } from './instrumentations/catalog';
import { mergeInstrumentations } from './instrumentations/merge';
import { resolveInstrumentations } from './instrumentations/resolve';
import { resolveTraceExporters, resolveLogExporters, type ExporterDeps } from './exporters/signals';
import { resolveMetricReaders } from './exporters/metrics';
import { registerShutdownHooks } from './shutdown';
import { canResolve, requireOptional } from './resolve';

const DEFAULT_DEPS: ExporterDeps = { canResolve, requireOptional };

export interface BuiltSdk {
  sdk: NodeSDK;
  instrumentations: unknown[];
  traceExporters: unknown[];
  metricReaders: unknown[];
  logExporters: unknown[];
  resourceAttributes: Record<string, string>;
}

export const createSdk = (config: ObservabilityConfig, deps: ExporterDeps = DEFAULT_DEPS): BuiltSdk => {
  const diag = createDiagnostics(config.diagnostics.level);

  const { descriptors, instances } = mergeInstrumentations(
    defaultCatalog(config),
    config.instrumentations,
  );
  const instrumentations = [
    ...resolveInstrumentations(descriptors, diag, deps),
    ...instances,
  ];

  // Exporters are resolved before the SDK is constructed so a bad spec throws
  // here rather than leaving a half-configured pipeline running.
  const traceExporters = resolveTraceExporters(config.traces.exporter, { endpoint: config.traces.endpoint }, diag, deps);
  const metricReaders = resolveMetricReaders(config.metrics.exporter, {
    endpoint: config.metrics.endpoint,
    exportIntervalMs: config.metrics.exportIntervalMs,
    port: config.metrics.port,
  }, diag, deps);
  const logExporters = resolveLogExporters(config.logs.exporter, { endpoint: config.logs.endpoint }, diag, deps);

  const resourceAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: config.service.name,
    [ATTR_SERVICE_VERSION]: config.service.version,
    ...config.resource.attributes,
  };

  const sdk = new NodeSDK({
    resource: resourceFromAttributes(resourceAttributes),
    ...(traceExporters.length > 0 ? { traceExporter: traceExporters[0] as never } : {}),
    ...(metricReaders.length > 0 ? { metricReaders: metricReaders as never[] } : {}),
    ...(logExporters.length > 0
      ? { logRecordProcessors: logExporters.map((e) => new BatchLogRecordProcessor(e as never)) }
      : {}),
    instrumentations: instrumentations as never[],
  });

  return { sdk, instrumentations, traceExporters, metricReaders, logExporters, resourceAttributes };
};

let started: BuiltSdk | undefined;

export interface SdkHandle extends BuiltSdk {
  unregisterShutdownHooks: () => void;
}

export const startObservability = (input: ObservabilityConfigInput = {}): SdkHandle => {
  const config = defineConfig(input);
  const diag = createDiagnostics(config.diagnostics.level);

  if (started) {
    diag.warn('observability is already started; ignoring the second call');
    return { ...started, unregisterShutdownHooks: () => undefined };
  }

  setTelemetryConfig(config);
  const built = createSdk(config);
  built.sdk.start();
  started = built;

  diag.info(`observability started for ${config.service.name}`);
  return { ...built, unregisterShutdownHooks: registerShutdownHooks(built.sdk, diag) };
};
```

`NodeSDK` accepts only one `traceExporter`; when several trace exporters are configured, the first is used and the rest need span processors. Wire only the first here and log a warning if more than one is supplied — full multi-exporter trace fan-out is a follow-up, and the array support in Task 15 already covers metrics and logs.

Add that warning after the `traceExporters` line:

```typescript
if (traceExporters.length > 1) {
  diag.warn(`${traceExporters.length} trace exporters configured; only the first is wired`);
}
```

- [ ] **Step 5: Write the node barrel**

Create `src/node/index.ts`:

```typescript
export { createSdk, startObservability } from './sdk';
export type { BuiltSdk, SdkHandle } from './sdk';
export { registerShutdownHooks } from './shutdown';
export { resolutionPaths, canResolve, requireOptional } from './resolve';
export { defaultCatalog } from './instrumentations/catalog';
export { mergeInstrumentations } from './instrumentations/merge';
export { resolveInstrumentations } from './instrumentations/resolve';
export type { InstrumentationDescriptor, InstrumentationEntry } from './instrumentations/types';
export { resolveTraceExporters, resolveLogExporters } from './exporters/signals';
export { resolveMetricReaders } from './exporters/metrics';
export type { NamedExporter, NamedMetricExporter } from './exporters/types';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest src/node/sdk.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add src/node/ package.json package-lock.json
git commit -m "feat(node): assemble the SDK from resolved instrumentations and exporters

createSdk returns the resolved parts alongside the SDK so a pipeline can
be asserted without starting it. startObservability guards against a
double bootstrap instead of patching modules twice."
```

---

### Task 19: The register entry, and retire the old bootstrap

**Files:**
- Create: `src/register.ts`
- Test: `src/register.spec.ts`
- Delete: `src/bootstrap.ts`, `src/bootstrap/sdk.ts`, `src/bootstrap/instrumentations.ts`, `src/bootstrap/shutdown.ts`, `src/tracing/tracer.ts`, `src/helpers.ts`
- Modify: `src/index.ts`, `src/tracing/telemetry.service.ts`, `package.json`

**Interfaces:**
- Consumes: `startObservability` (Task 18).
- Produces: the `./register` side-effect entry point.

- [ ] **Step 1: Write the failing test**

Create `src/register.spec.ts`:

```typescript
describe('register entry', () => {
  const OLD = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD, OTEL_TRACES_EXPORTER: 'console', OTEL_METRICS_EXPORTER: 'none', OTEL_LOGS_EXPORTER: 'none' };
  });

  afterEach(() => { process.env = OLD; });

  it('starts without throwing when no collector is running', () => {
    expect(() => require('./register')).not.toThrow();
  });

  it('exposes the started handle', () => {
    const mod = require('./register') as { handle: { sdk: unknown } };
    expect(mod.handle.sdk).toBeDefined();
  });

  it('does not load dotenv', () => {
    require('./register');
    expect(Object.keys(require.cache).join('|')).not.toContain('node_modules/dotenv');
  });
});
```

The third test is the executable form of "a library must not mutate the host's environment", replacing `require('dotenv').config()` at `src/bootstrap.ts:1`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/register.spec.ts`
Expected: FAIL — `Cannot find module './register'`.

- [ ] **Step 3: Implement the register entry**

Create `src/register.ts`:

```typescript
/**
 * Side-effect entry point. Preload before the application so instrumentation
 * patches modules before they are required:
 *
 *   node -r @yourscope/observability/register dist/main.js
 *
 * Deliberately does NOT load dotenv — a library must not mutate the host's
 * environment. Use `node -r dotenv/config -r @yourscope/observability/register`.
 */
import { startObservability } from './node/sdk';

export const handle = startObservability();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/register.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Repoint the remaining old files**

`src/tracing/telemetry.service.ts` currently imports `getRequestContext, meter, withSpan` from `./tracer`, which is being deleted. Change it to extend the core class so the Nest surface keeps working until Stage 3:

```typescript
import { Injectable } from '@nestjs/common';
import { Telemetry } from '../core/telemetry/telemetry';

@Injectable()
export class TelemetryService extends Telemetry {}
```

Then update `src/index.ts`: export `withSpan` from `./core/telemetry/spans`, `getTracer`/`getMeter` from `./core/telemetry/handles`, and `loadObservabilityConfig` becomes a deprecated alias:

```typescript
export { defineConfig, defineConfig as loadObservabilityConfig } from './core/config/define-config';
```

`src/config.ts` keeps its `registerAs` export for the Nest files, but its body becomes a thin wrapper over `defineConfig` rather than a module-level snapshot:

```typescript
import { registerAs } from '@nestjs/config';
import { defineConfig } from './core/config/define-config';

export const OBSERVABILITY_NAMESPACE = 'observability';
export const loadObservabilityConfig = defineConfig;
export const observabilityConfig = registerAs(OBSERVABILITY_NAMESPACE, () => defineConfig());
export type { ObservabilityConfig } from './core/config/types';
export default defineConfig();
```

- [ ] **Step 6: Delete the superseded files**

```bash
git rm src/bootstrap.ts src/bootstrap/sdk.ts src/bootstrap/instrumentations.ts src/bootstrap/shutdown.ts src/tracing/tracer.ts src/helpers.ts
```

- [ ] **Step 7: Update the package entry points**

In `package.json`, replace the `./bootstrap` export with the new subpaths, keeping the existing `"@libs/source"` condition pattern:

```json
"exports": {
  "./package.json": "./package.json",
  ".": { "@libs/source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./core": { "@libs/source": "./src/core/index.ts", "types": "./dist/core/index.d.ts", "default": "./dist/core/index.js" },
  "./node": { "@libs/source": "./src/node/index.ts", "types": "./dist/node/index.d.ts", "default": "./dist/node/index.js" },
  "./register": { "@libs/source": "./src/register.ts", "types": "./dist/register.d.ts", "default": "./dist/register.js" }
}
```

Update `typesVersions` to match, replacing the `bootstrap` entry with `core`, `node`, and `register`. Remove `dotenv` from `dependencies`.

The npm scope rename and the peer-dependency restructuring are Stage 4 work and are deliberately not done here.

- [ ] **Step 8: Run the whole suite and the build**

```bash
npm test
npm run build
```

Expected: every test passes and `dist/` builds clean. If a Nest file fails to compile, fix its import path only — no logic changes in this plan.

- [ ] **Step 9: Manual smoke check**

```bash
node -e "process.env.OTEL_TRACES_EXPORTER='console'; process.env.OTEL_METRICS_EXPORTER='none'; process.env.OTEL_LOGS_EXPORTER='none'; process.env.OTEL_DIAG_LEVEL='debug'; require('./dist/register.js'); const {withSpan}=require('./dist/core/index.js'); withSpan('smoke', async()=>1).then(()=>setTimeout(()=>process.exit(0),500));"
```

Expected: diagnostic lines naming which instrumentations were skipped and why, followed by a `smoke` span printed to the console. This is the proof that the package works with no collector running.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: replace the bootstrap entry with a dotenv-free register entry

The old bootstrap hardcoded three OTLP exporters and called dotenv.config()
inside the library. The register entry resolves everything from config and
leaves the host's environment alone. Deletes the superseded bootstrap,
tracer, and helpers modules."
```

---

## Verification

After Task 19, all of these must hold:

- `npm test` — all tests pass, no skipped suites.
- `npm run build` — clean `dist/` with declarations.
- The Task 10 isolation test passes: importing `src/core/index.ts` loads no `@nestjs`, `pino`, or `axios` module.
- The Task 19 smoke check prints a span with no collector running.
- `src/observability.module.ts` and the three Nest logging files still compile untouched.

## Follow-up plans

**Stage 3 — NestJS adapter.** Move the module, interceptor, filter, and HTTP client logger under `src/nestjs/`, swap `observabilityConfig.KEY` for the `OBSERVABILITY_CONFIG` token, make `@nestjs/config` optional, move the pino binding to `./pino`, and delete the `src/logging/` re-export shims.

**Stage 4 — Packaging and release.** Rename to a public npm scope, move the SDK and instrumentation packages from `devDependencies` to `peerDependenciesMeta.optional`, add `LICENSE`, rewrite the README for a public audience, populate the eslint config, and set up CI with `npm publish --provenance`.
