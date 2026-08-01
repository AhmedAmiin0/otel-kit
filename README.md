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

### Using a different logger

pino is a convenience, not a requirement. Everything that builds a log record lives in
`otel-kit/core` and depends on nothing but Node's `http` types, so winston, bunyan, or your own
wrapper get the same redaction, body capture, and level mapping.

winston has a binding of its own:

```ts
import winston from 'winston';
import { createWinstonLogger } from 'otel-kit/winston';
import { logRequest, defineConfig } from 'otel-kit/core';

const config = defineConfig();
const logger = createWinstonLogger(
  winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()],
  }),
);

app.use((req, res, next) => {
  res.on('finish', () => logRequest(logger, req, res, config));
  next();
});
```

Every other Node logger follows one of two argument conventions, and there is an adapter for each:

```ts
import { fromMessageFirst, fromObjectFirst } from 'otel-kit/core';

fromMessageFirst(log4jsLogger);   // info(message, meta) — winston, log4js, consola, tslog
fromObjectFirst(bunyanLogger);    // info(obj, msg)      — bunyan, pino
```

| Logger | Adapter | Notes |
| --- | --- | --- |
| pino | none needed | already the `ObsLogger` shape |
| bunyan | `fromObjectFirst` | native `child` bindings are preserved |
| winston | `createWinstonLogger` or `fromMessageFirst` | |
| log4js | `fromMessageFirst` | has no `child`; the adapter carries bindings itself |
| consola, tslog | `fromMessageFirst` | tslog 5 is ESM-only, so it needs an ESM app |

`fromMessageFirst` merges child bindings on its own rather than delegating, so `logger.child({ svc })`
works even against loggers with no child concept.

That gives you the same records pino produces: redacted request and response bodies, sanitized
headers, correlation id, and `4xx → warn` / `5xx → error` levels. Excluded routes and `3xx` are
skipped for you.

If you want the pieces rather than the whole record, they compose individually:

| Export | Does |
| --- | --- |
| `buildRequestLog(req, res, config, err?)` | The record and its level, or `undefined` when the request should be skipped |
| `serializeRequest(req, config)` | Redacted request view |
| `serializeResponse(res, config)` | Redacted response view, including the captured body |
| `redactAndSerialize(value, redaction)` | Redact and truncate any value |
| `httpLogLevel(req, res, err?)` | Status to level, with `'silent'` for redirects |

Response bodies are captured into a `WeakMap` keyed by the response object, so `serializeResponse`
can reach them from any logger — that part was never pino-specific.

### Outbound HTTP logging

Outbound calls are logged with the same redaction as inbound ones, and it wires itself up. Import
`HttpModule` however you like and there is nothing else to do:

```ts
@Module({
  imports: [HttpModule.register({ timeout: 5000 })],   // or a bare HttpModule
})
export class ApiModule {}
```

The logger looks `HttpService` up from the container at startup rather than having it injected. That
matters because `HttpModule.register(...)` provides a *different* instance from the static
`HttpModule` — anything that bound one at module-definition time would patch an instance your code
never calls through, and would do it silently.

If no `HttpModule` is present the logger stays idle and says so at debug level. Set
`LOG_HTTP_CLIENT=false` to turn it off entirely.

### Global providers

**Response-body interceptor**, registered by default. It captures response bodies for logging and,
on the error path, backfills the span route for requests that matched no handler — without that,
those traces are named generically.

`LOG_RESPONSE_BODY=false` stops bodies being captured but leaves the interceptor in place, since the
route backfill is worth having either way. The `interceptor` option takes it further — skip it,
substitute your own class, or supply a provider outright:

```ts
ObservabilityModule.forRoot({ interceptor: false });          // none
ObservabilityModule.forRoot({ interceptor: MyInterceptor });  // your class instead

// a full provider, so useFactory and useExisting work as usual
ObservabilityModule.forRoot({
  interceptor: {
    provide: APP_INTERCEPTOR,
    inject: [SomeService],
    useFactory: (svc: SomeService) => new MyInterceptor(svc),
  },
});
```

Extending the built-in rather than replacing it works too, since it is exported:

```ts
import { ResponseBodyInterceptor } from 'otel-kit/nestjs';

@Injectable()
class MyInterceptor extends ResponseBodyInterceptor {}
```

**No global exception filter.** This package deliberately registers none. `APP_FILTER` is not a
cumulative token — whichever global filter Nest picks is the only one that runs — so a filter shipped
here would take over exception handling for your whole application and silently stop your own filter
from running. Same code, same routes, but your error shapes replaced by generic 500s.

The interceptor does that work instead: it observes the error, backfills the route, captures the
body, and rethrows. `APP_INTERCEPTOR` is cumulative, so your filters and interceptors keep behaving
exactly as they did before you installed this.

## Redaction

Request and response bodies are redacted before they are logged. Matching keys are replaced, output
is truncated, and depth is capped so a cyclic or enormous payload cannot flood your logs.

```bash
LOG_RESPONSE_BODY_REDACT=password,token,secret,apiKey
LOG_BODY_MAX_CHARS=500     # characters kept in the log line
LOG_BODY_MAX_DEPTH=8       # how deep the walk descends
LOG_BODY_MAX_NODES=1000    # how many values the walk visits
```

`LOG_BODY_MAX_NODES` bounds the work, not just the output. Without it a large parsed upload would be
copied in full and then thrown away by the character limit — on a 50k-node payload that is roughly
38× more time spent for byte-identical output.

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
| `otel-kit/winston` | winston binding | `winston` |

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
