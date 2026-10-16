# Adding a framework adapter

The core speaks Web `Request`/`Response` and nothing else. An adapter is a translation layer: framework request in, Web `Request` to the core, Web `Response` out. It must not reimplement routing, challenges or metadata.

## The contract

| Function | From | Returns | Use for |
|---|---|---|---|
| `authenticate(source, request, opts?)` | `@neon/oauth/adapter` | `{ ok: true, auth } \| { ok: false, response }` | Bearer guard. `source` is an `OAuth` (then `opts.audience` is required unless `createOAuth` was given a `resource`) or an `McpResourceServer`. Send `response` as-is on failure (401/403/503 with an RFC 6750 `WWW-Authenticate`). |
| `routeOAuthClient(client, request, { basePath? })` | `@neon/oauth/adapter` | `Promise<Response \| undefined>` | `GET {basePath}/login`, `/callback`, `/logout`. `undefined` means "not mine, keep routing". |
| `routeMcpMetadata(mcp, request)` | `@neon/oauth/mcp` | `Response \| undefined` | GET/OPTIONS on the RFC 9728 metadata paths (path-inserted and bare), with CORS. |

For MCP guards `@neon/oauth/mcp` also exports `MCP_METHODS` (`POST`, `GET`, `DELETE`) and `mcpPath(mcp, path?)` (defaults to the path of `mcp.resource`).

`basePath` is derived from the client's `redirectUri`: its path must end in `/callback`, and the rest is the prefix (`<origin>/api/auth/callback` serves `/api/auth/*`). An explicit `basePath` is only a check: `routeOAuthClient` and `resolveBasePath(client, opts)` throw, naming both values, if it disagrees. Call `resolveBasePath` when the adapter is created so a mismatch fails at startup, not on the first request.

## Template

An adapter imports `@neon/oauth/adapter` (sign-in and generic APIs) or `@neon/oauth/mcp` (MCP servers). Keep the two apart: importing only `@neon/oauth/mcp` keeps `openid-client` out of an MCP server's dependency graph.

```ts
// Type-only framework imports, so the framework stays an optional peer.
import type { MyCtx, MyMiddleware } from "myfw";
import { authenticate, resolveBasePath, routeOAuthClient } from "@neon/oauth/adapter";
import type { OAuth, OAuthBearerOptions, OAuthClient } from "@neon/oauth/adapter";

const toRequest = (ctx: MyCtx): Request => /* ctx.rawRequest, or new Request(url, { method, headers }) */;

export function myBearerAuth(source: OAuth, opts: OAuthBearerOptions): MyMiddleware {
  return async (ctx, next) => {
    const out = await authenticate(source, toRequest(ctx), opts);
    if (!out.ok) return ctx.send(out.response); // 1. failure: send the ready Response
    ctx.state.auth = out.auth; // 2. success: expose AuthResult where the framework keeps per-request data
    return next();
  };
}

export const myOAuthClient = (client: OAuthClient): MyMiddleware => {
  resolveBasePath(client); // fail at startup if redirectUri and basePath disagree
  return async (ctx, next) => {
    const res = await routeOAuthClient(client, toRequest(ctx));
    return res ? ctx.send(res) : next(); // undefined = fall through
  };
};
```

Node-style `(req, res, next)` frameworks can build on `nodeMiddleware`, `nodeBearerAuth` and `nodeOAuthClient` from `@neon/oauth/node`, and `nodeMcp` from `@neon/oauth/mcp/node`. That is how the Express adapters are implemented in a few lines each.

## Checklist

1. Framework imports are `import type` only, and the framework is an optional peer dependency.
2. Only call `authenticate`, `routeOAuthClient`, `resolveBasePath`, `routeMcpMetadata`. No `instanceof Response` checks, no path matching of your own.
3. Forward every `Set-Cookie` separately (`response.headers.getSetCookie()`); `Headers` folds them otherwise.
4. Pass method, full URL (with query) and headers to the `Request`. Bodies are not needed by any contract function.
5. Don't run a body parser before an MCP guard: the transport must read the raw body.
6. Smoke test it: 401 without a token, 200 with one, metadata, `/logout` redirect.

## Fetch-based runtimes (Bun, Deno, Workers)

No adapter needed. The core already takes a `Request` and returns a `Response`:

```ts
export default {
  async fetch(request: Request) {
    return (await routeOAuthClient(oauth.client, request)) ?? routeMcpMetadata(mcp, request) ?? (await app(request));
  },
};
```
