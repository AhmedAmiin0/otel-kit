# otel-kit

OpenTelemetry setup that configures itself from the packages your app already has.

Most OpenTelemetry wiring looks the same in every service, and most of it is spent deciding which
instrumentations to load and where to send the data. `otel-kit` does both by inspecting your
application at startup: if `pg` is installed, Postgres tracing turns on; if it isn't, nothing is
loaded and nothing is required. Exporters are configuration, not hardcoded, so a collector is one
option rather than the only one.

Only `@opentelemetry/api` and `tslib` are runtime dependencies. Everything else is an optional peer
you install if you use it.

## Install

```bash
npm install otel-kit @opentelemetry/sdk-node @opentelemetry/resources \
  @opentelemetry/sdk-logs @opentelemetry/sdk-metrics @opentelemetry/semantic-conventions
```

Then add the instrumentations you actually want:

```bash
npm install @opentelemetry/instrumentation-http @opentelemetry/instrumentation-pg
```

If you skip one, startup tells you exactly what to install to enable it. Nothing crashes.

## Use

Preload the register entry so instrumentation patches modules before your app requires them:

```bash
node -r otel-kit/register dist/main.js
```

That's the whole setup. Configure through environment variables:

```bash
OTEL_SERVICE_NAME=orders-api
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318
```

Then create spans and metrics anywhere:

```ts
import { withSpan, Telemetry } from 'otel-kit/core';

await withSpan('charge-card', async (span) => {
  span.setAttribute('order.id', orderId);
  return gateway.charge(order);
});

const telemetry = new Telemetry();
telemetry.increment('orders.placed', { channel: 'web' });
```

`otel-kit` does not read `.env` files — a library should not mutate your environment. Load it
yourself if you need to:

```bash
node -r dotenv/config -r otel-kit/register dist/main.js
```

## Where telemetry goes

Each signal is configured independently. A collector is the default, not a requirement.

```ts
import { startObservability } from 'otel-kit/node';

startObservability({
  traces: { exporter: 'otlp-grpc', endpoint: 'http://tempo:4317' },
  metrics: { exporter: 'prometheus', port: 9464 },  // pull, not push
  logs: { exporter: 'none' },
});
```

| Value | Behaviour |
| --- | --- |
| `otlp-http` | Default. OTLP over HTTP. |
| `otlp-grpc`, `otlp-proto` | Alternative OTLP transports. |
| `console` | Prints to stdout. Needs no extra package and no collector — useful in dev and tests. |
| `prometheus` | Metrics only. Serves `/metrics` for scraping instead of pushing. |
| `none` | Disables the signal. |

For anything else, pass an exporter instance or a factory directly:

```ts
startObservability({
  traces: { exporter: new DatadogSpanExporter({ /* ... */ }) },
});
```

Arrays fan out to several backends. Requesting an exporter whose package isn't installed throws at
startup with the install command, rather than silently sending telemetry nowhere.

## Instrumentations

The built-in catalog covers `http`, `express`, `nestjs`, `kafkajs`, `typeorm`, `pg`, `ioredis`,
`mongodb`, `graphql`, and `fs`. Each is gated on two independent checks: the library it instruments
must be present, and its own package must be installed. Anything missing is skipped with a log line,
never an error.

Override by name:

```ts
startObservability({
  instrumentations: {
    http: { config: { ignoreIncomingRequestHook: myHook } },   // patch a built-in
    typeorm: false,                                            // turn one off
    amqplib: {                                                 // add one
      module: '@opentelemetry/instrumentation-amqplib',
      requires: 'amqplib',
    },
    custom: new MyInstrumentation(),                           // pass an instance
  },
});
```

Or from the environment, without a rebuild:

```bash
OTEL_INSTRUMENTATIONS=http,pg
OTEL_INSTRUMENTATIONS_DISABLED=fs
```

## NestJS

Optional, behind its own subpath. Requires `@nestjs/common` and `@nestjs/core`; `@nestjs/config` is
not needed.

```ts
import { ObservabilityModule } from 'otel-kit/nestjs';

@Module({
  imports: [ObservabilityModule.forRoot()],
})
export class AppModule {}
```

`TelemetryService` is then injectable everywhere. `forRootAsync` is available if you build the
config from `ConfigService` or another async source.

Request logging uses pino when `nestjs-pino` is installed and is skipped when it isn't. To use the
logger:

```ts
import { useObservabilityLogger } from 'otel-kit/pino';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
useObservabilityLogger(app);
```

The built-in pino wiring is a default, not a requirement. Adjust it, replace it, or turn it off:

```ts
// tweak the generated config — you get the defaults and return what you want
ObservabilityModule.forRoot({
  logger: (defaults) => ({
    ...defaults,
    pinoHttp: { ...defaults.pinoHttp, level: 'debug', transport: myTransport },
  }),
});

// bring a different logger entirely
ObservabilityModule.forRoot({ logger: WinstonModule.forRoot(myOptions) });

// no request logging; tracing and metrics still work
ObservabilityModule.forRoot({ logger: false });
```

The redaction helpers are logger-agnostic, so they keep working whichever you choose — import
`redactAndSerialize` and `buildSerializers` from `otel-kit/core`.

### Global providers

The module registers two things on the request path, both optional.

**Response-body interceptor.** Captures response bodies so they can be logged. It follows
`logging.responseBody`, so turning that off skips registration entirely rather than installing an
interceptor that runs on every request and does nothing:

```bash
LOG_RESPONSE_BODY=false
```

```ts
ObservabilityModule.forRoot({ config: { logging: { responseBody: false } } });
ObservabilityModule.forRoot({ responseBodyInterceptor: false });   // explicit override
```

**Exception filter.** Captures error response bodies, and backfills the span route for requests that
matched no handler — without it those traces are named generically. It stays on when the interceptor
is off. Disable it if you register your own global filter and they conflict:

```ts
ObservabilityModule.forRoot({ exceptionFilter: false });
```

Both options work on `forRootAsync` too, where they default to `true` because the config isn't known
until the factory runs.

## Redaction

Request and response bodies are redacted before they are logged. Matching keys are replaced, output
is truncated, and depth is capped so a cyclic or enormous payload cannot flood your logs.

```bash
LOG_RESPONSE_BODY_REDACT=password,token,secret,apiKey
LOG_BODY_MAX_CHARS=500
```

Defaults cover `password`, `token`, `secret`, `accessToken`, `refreshToken`, `apiKey`, and
`authorization`. The `authorization`, `cookie`, and `x-api-key` headers are always masked.

## Entry points

| Import | Contains | Needs |
| --- | --- | --- |
| `otel-kit/core` | Config, spans, metrics, redaction, logger interface | `@opentelemetry/api` only |
| `otel-kit/node` | SDK bootstrap, instrumentation and exporter resolution | OTel SDK packages |
| `otel-kit/register` | Preload entry, starts everything | OTel SDK packages |
| `otel-kit/nestjs` | Module, interceptor, exception filter, HTTP client logger | `@nestjs/common`, `@nestjs/core` |
| `otel-kit/pino` | pino binding and Nest logger wiring | `pino`, `nestjs-pino` |

`otel-kit/core` is framework-free and pulls in nothing but `@opentelemetry/api` — enforced by a test,
not just by convention.

## Configuration

Environment variables are the common path; anything passed to `startObservability` or
`ObservabilityModule.forRoot` takes precedence over them.

| Variable | Default |
| --- | --- |
| `OTEL_SERVICE_NAME` (or `MS_NAME`) | `unknown-service` |
| `OTEL_SERVICE_VERSION` | `0.0.1` |
| `OTEL_TRACES_EXPORTER` / `OTEL_METRICS_EXPORTER` / `OTEL_LOGS_EXPORTER` | `otlp-http` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | OTLP default |
| `OTEL_METRIC_EXPORT_INTERVAL` | `5000` |
| `OTEL_PROMETHEUS_PORT` | `9464` |
| `OTEL_IGNORE_ROUTES` | `/health,/health-check,/metrics` |
| `OTEL_DIAG_LEVEL` | `none` |
| `LOG_LEVEL` | `info` |

Set `OTEL_DIAG_LEVEL=debug` to see which instrumentations were loaded or skipped, and why.

## Local stack

`docker compose up -d` starts a collector plus Grafana, Tempo, Loki, and Prometheus. Point the app at
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4328`; Grafana is on <http://localhost:3001>.

## Licence

MIT
