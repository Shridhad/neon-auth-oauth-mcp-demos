# Adding a framework adapter

Core speaks Web `Request`/`Response` and nothing else. An adapter is a translation layer: framework request in, Web `Request` to core, Web `Response` out. It must not reimplement routing, challenges or metadata.

## The contract (`@neon/oauth-client/adapter`, source `src/adapters/core.ts`)

| Function | Returns | Use for |
|---|---|---|
| `authenticate(source, request, opts?)` | `{ ok: true, auth } \| { ok: false, response }` | Bearer guard. `source` is an `OAuth` (then `opts.audience` is required) or an `McpResourceServer`. Send `response` as-is on failure (401/403/503 with an RFC 6750 `WWW-Authenticate`). |
| `routeOAuthClient(client, request, { basePath? })` | `Promise<Response \| undefined>` | `GET {basePath}/login`, `/callback`, `/logout`. `undefined` means "not mine, keep routing". |
| `routeMcpMetadata(mcp, request)` | `Response \| undefined` | GET/OPTIONS on the RFC 9728 metadata paths (path-inserted and bare), with CORS. |

Also exported for MCP guards: `MCP_METHODS` (`POST`, `GET`, `DELETE`) and `mcpPath(mcp, path?)` (defaults to the path of `mcp.resource`).

`basePath` defaults to `/auth`: a dedicated prefix cannot collide with app routes, and `redirectUri` is then `<origin>/auth/callback`. Pass `''` to serve at the root, or the framework's mount point (Next uses `/api/auth`). A catch-all route that cannot know its prefix is why the prefix is a parameter rather than inferred.

## Template

```ts
// src/adapters/myfw.ts: type-only framework imports, so the framework stays an optional peer.
import type { MyApp, MyMiddleware } from 'myfw';
import { authenticate, routeMcpMetadata, routeOAuthClient } from './core.js';
import type { AuthResult, McpResourceServer, OAuth, OAuthBearerOptions, OAuthClient, OAuthRouteOptions } from './core.js';
import type { BearerAuthOptions } from '../bearer.js';

const toRequest = (ctx: MyCtx): Request => /* ctx.rawRequest, or build new Request(url, { method, headers }) */;

export function myBearerAuth(source: McpResourceServer, opts?: BearerAuthOptions): MyMiddleware;
export function myBearerAuth(source: OAuth, opts: OAuthBearerOptions): MyMiddleware;
export function myBearerAuth(source: McpResourceServer | OAuth, opts: BearerAuthOptions | OAuthBearerOptions = {}): MyMiddleware {
  return async (ctx, next) => {
    const out = await authenticate(source as OAuth, toRequest(ctx), opts as OAuthBearerOptions);
    if (!out.ok) return ctx.send(out.response);   // 1. failure: send the ready Response
    ctx.state.auth = out.auth;                    // 2. success: expose AuthResult where the framework keeps per-request data
    return next();
  };
}

export const myOAuthClient = (client: OAuthClient, opts?: OAuthRouteOptions): MyMiddleware =>
  async (ctx, next) => {
    const res = await routeOAuthClient(client, toRequest(ctx), opts);
    return res ? ctx.send(res) : next();          // undefined = fall through
  };
```

Node-style `(req, res, next)` frameworks should build on `nodeMiddleware` / `nodeBearerAuth` / `nodeMcp` / `nodeOAuthClient` in `src/adapters/node.ts` (that is how Express is implemented in 30 lines).

## Checklist

1. File at `src/adapters/<name>.ts`; framework imports are `import type` only; add the framework as an optional peer in `package.json` (`peerDependenciesMeta`) and as a devDependency if tests need it at runtime.
2. Add `"./<name>"` to `exports` in `package.json` pointing at `dist/adapters/<name>.{js,d.ts}`.
3. Only call `authenticate`, `routeOAuthClient`, `routeMcpMetadata`. No `instanceof Response` checks, no path matching of your own.
4. Forward every `Set-Cookie` separately (`response.headers.getSetCookie()`); `Headers` folds them otherwise.
5. Pass method, full URL (with query) and headers to the `Request`. Bodies are not needed by any contract function.
6. Don't run a body parser before an MCP guard: the transport must read the raw body.
7. Add a smoke test in `test/adapters.test.ts`: 401 without a token, 200 with one, metadata, `/logout` redirect.
8. Document the snippet in `README.md`.

## Fetch-based runtimes (Bun, Deno, Workers)

No adapter needed. The core already takes a `Request` and returns a `Response`:

```ts
export default {
  async fetch(request: Request) {
    return (await routeOAuthClient(oauth.client, request)) ?? routeMcpMetadata(mcp, request) ?? (await app(request));
  },
};
```
