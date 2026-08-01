# otel-kit demo

One POST endpoint that makes one outbound call to jsonplaceholder. It exercises the
parts that are awkward to see from unit tests: inbound body logging, redaction,
response capture, outbound HTTP logging and a span.

```bash
npm run demo
```

That builds the package, compiles this folder and starts it on port 3000. Then:

```bash
curl -X POST http://localhost:3000/posts \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer super-secret' \
  -H 'x-request-id: demo-1' \
  -d '{"title":"otel-kit","body":"hello","userId":1,"apiKey":"leak-me-not"}'
```

## What to look for

**The request log**, written through winston, not pino:

```json
{
  "context": "HTTP",
  "correlation_id": "demo-1",
  "level": "info",
  "message": "POST /posts 201",
  "req": {
    "body": "{\"title\":\"otel-kit\",\"body\":\"hello\",\"userId\":1,\"apiKey\":\"XXXXXXXXXXXXXXXX\"}",
    "headers": { "authorization": "XXXXXXXXXXXXXXXX", "x-request-id": "demo-1" }
  },
  "res": {
    "body": "{\"published\":{\"title\":\"otel-kit\",\"body\":\"hello\",\"userId\":1,\"id\":101}}",
    "statusCode": 201
  }
}
```

`apiKey` and `authorization` are redacted by default. `correlation_id` comes from
`x-request-id`, and the same header is echoed back on the response.

**The outbound call**, logged by `HttpClientLogger` because `HttpModule` is imported:

```
--> POST https://jsonplaceholder.typicode.com/posts
    client_req_body: {"title":"otel-kit","body":"hello","userId":1}
<-- POST https://jsonplaceholder.typicode.com/posts 201 567ms
    client_res_body: {"title":"otel-kit","body":"hello","userId":1,"id":101}
```

`apiKey` is absent rather than redacted here. Redaction keeps a secret out of the
logs; it does not make it safe to forward, so `PostsService` drops it before the
call.

**The span**, printed by the console exporter, so no collector has to be running:

```
name: 'posts.publish',
traceId: '8abe2362ce4ca45bd68a2924a5092f7b',
duration: 569465.6
```

**The startup diagnostics**, at `debug`, showing runtime instrumentation resolution:

```
[observability] enabled http via @opentelemetry/instrumentation-http
[observability] enabled express via @opentelemetry/instrumentation-express
[observability] skip nestjs: install @opentelemetry/instrumentation-nestjs-core to enable it
[observability] skip kafkajs: kafkajs is not installed
[observability] exporter console ready
```

Three outcomes, no configuration behind any of them. `http` and `express` are
enabled because those packages are installed here. `nestjs` is skipped because
its instrumentation is not installed, and says how to change that. `kafkajs` is
skipped because the application does not use kafkajs at all, so there would be
nothing to instrument. Nothing fails in any case.

Install `@opentelemetry/instrumentation-nestjs-core` and restart to see the
first kind flip to the second — the catalog picks it up with no config change.

## Notes on the wiring

| File | Role |
| --- | --- |
| `observability.config.ts` | The config, written once |
| `main.ts` | Starts the SDK, then boots Nest |
| `app.module.ts` | `ObservabilityModule.forRoot({ logger, config })` |

`startObservability()` is called first thing in `bootstrap()`. It is synchronous
and registers its own shutdown hooks, so there is nothing to await and nothing to
flush by hand.

Both that call and the Nest module take the same `observability` object, so the
service name, exporters and redaction rules cannot drift apart.

### On start order

Instrumentation works by hooking `require`, so the usual advice is to start the
SDK from a preload, before anything pulls in http or express:

```bash
node -r otel-kit/register ./out/main.js     # config from the environment
```

Starting it inside `bootstrap()` instead was measured against that, with
`instrumentation-http` and `instrumentation-express` installed and one POST to
`/posts`. Both produce the same five spans:

```
POST /posts                      (http server)
request handler - /posts         (express)
request handler - {/*splat}      (express)
posts.publish                    (manual)
POST                             (http client, outbound)
```

It holds even with `import 'express'` above the call. The hook intercepts
`Module._load`, which runs again on a cache hit, so a module required a second
time after the SDK starts still gets patched — and Nest requires its HTTP
platform lazily inside `NestFactory.create()`, which is after.

What that depends on is the application's load order rather than anything the SDK
controls, and OpenTelemetry does warn when a target module was loaded first
(`Module X has been loaded before Y so it might not work`). A preload does not
depend on it. For an app this size the difference is not observable; for one that
touches http at import time and never again, prefer the preload.

Imports read `otel-kit/nestjs` rather than relative paths, so this is the code a
consumer would write. Node resolves it through the package's own exports map;
`tsconfig.json` maps the subpaths for the compiler, which cannot follow that map
under `moduleResolution: node10`.
