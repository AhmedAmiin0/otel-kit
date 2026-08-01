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
[observability] skip http: install @opentelemetry/instrumentation-http to enable it
[observability] skip express: install @opentelemetry/instrumentation-express to enable it
[observability] skip kafkajs: kafkajs is not installed
[observability] exporter console ready
```

Two different reasons: the first two are packages you could install and haven't,
the third is for a library this app does not use. Nothing fails either way.

For full HTTP and Nest spans, install the instrumentation and restart — the
catalog picks them up with no config change:

```bash
npm i @opentelemetry/instrumentation-http @opentelemetry/instrumentation-express \
      @opentelemetry/instrumentation-nestjs-core
```

## Notes on the wiring

`main.ts` calls `startObservability()` before the app loads and uses dynamic
imports underneath, because static imports are hoisted and instrumentation has to
patch modules on their way in. `node -r otel-kit/register` does the same from the
command line, taking its config from the environment instead.

Imports here read `otel-kit/nestjs` rather than relative paths, so this is the
same code a consumer would write. Node resolves it through the package's own
exports map; `tsconfig.json` maps the subpaths for the compiler, which cannot
follow that map under `moduleResolution: node10`.
