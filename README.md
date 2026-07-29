# observability-client

This library was generated with [Nx](https://nx.dev).

opentelemetry + pino for our nest microservices.

# how to install

**use pnpm, not npm.** the `path:` fragment that pulls a single folder out of the monorepo is a
pnpm feature. npm ignores the whole fragment, so it checks out the default branch and installs the
repo root instead of this library.

releases live on the `observability-release` branch, which carries a prebuilt `dist`. pin to a
release tag and add this to the package.json

```json
"dependencies": {
  "@libs/observability": "git+http://10.104.1.197:7990/scm/business-utilities-projects/business-utilities.git#observability-v0.0.1&path:/libs/observability"
}
```

run pnpm i

do not point the dependency at `observabilty` or `development`. those branches have no `dist` in
them, so the install succeeds but the package lands empty and every import fails at runtime.

# how to cut a release

from a clean tree on the branch that holds the library source, bump `version` in
`libs/observability/package.json`, then

```powershell
./libs/observability/release.ps1 -Push
```

it builds `dist`, force-updates the `observability-release` branch off your current branch with
that `dist` committed, and tags it `observability-v<version>`. the branch moves on every release,
so consumers pin to the tag. drop `-Push` for a dry run that stays local.

# how to use it

in the main.ts, import the bootstrap at the very beginning of the file, before any other import,
then after initializing the app add the logger

```ts
import '@libs/observability/bootstrap';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
useObservabilityLogger(app);
```

after that in the appModule register the `ObservabilityModule.forRoot()`. it is global, so
`TelemetryService` is available everywhere if you need your own spans and counters.

# env vars

each ms needs its own name, set `OTEL_SERVICE_NAME` .(or `MS_NAME`) or everything shows up as
`unknown-service`. to enable db logging set `OTEL_TYPEORM_ENABLED` to true. the rest is in
`src/config.ts`

for the local stack, `docker compose up -d` from `libs/observability`, point the app at
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4328` and grafana is on <http://localhost:3001>.
# observability
