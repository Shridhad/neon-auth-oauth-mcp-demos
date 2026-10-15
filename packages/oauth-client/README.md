# @neon/oauth-client

Internal helper (private, not published) for apps built on Neon Auth. You give it the Neon Auth URL (the OAuth issuer); it handles discovery, PKCE login, encrypted session cookies, and bearer-token verification.

## Quick start: sign users in / protect an API (`@neon/oauth-client`)

One factory, one issuer. Everything it returns (token verification, MCP servers, the OAuth client) shares a single discovery cache and key set. Configuration is explicit, like `@neon/auth`: nothing is read from the environment.

```ts
import { createOAuth } from '@neon/oauth-client';

export const oauth = createOAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!, // the OAuth issuer, e.g. https://ep-x.neonauth.../neondb/auth
  // Only for signing users in (oauth.client):
  clientId: process.env.NEON_AUTH_CLIENT_ID,
  clientSecret: process.env.NEON_AUTH_CLIENT_SECRET, // omit for a public client
  redirectUri: 'http://localhost:3000/auth/callback', // must be registered on the client
  resource: 'http://localhost:3000/api', // becomes the token's `aud`
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! }, // 32+ chars: openssl rand -hex 32
});
```

`baseUrl` is required and must be an absolute URL. Client settings (`clientId`, `redirectUri`, `cookies.secret`) are checked lazily, the first time `oauth.client` is touched, so API-only apps need none of them.

| Option | Notes |
|---|---|
| `cookies` | `{ secret, name = 'neon_auth_session', maxAgeSeconds = 7d, domain, sameSite = 'lax' }`. `sameSite` and `domain` apply to the session cookie; the short-lived login cookie is always Lax. |
| `scopes` | Default `['openid', 'profile', 'email']`. |
| `algorithms`, `clockTolerance` | Token verification. Algorithms default to `['EdDSA']`. |
| `discovery` | `{ ttlMs = 1h, failureBackoffMs = 5s }`. |
| `jwks` | Passed to jose's `createRemoteJWKSet`. |

### Protect an API

```ts
// Hono
app.get('/api/things', honoBearerAuth(oauth, { audience: 'http://localhost:3100/api', requiredScopes: ['read'] }), (c) => c.json({ user: c.get('auth').sub }));

// Express
app.get('/api/things', expressBearerAuth(oauth, { audience }), (req, res) => res.json({ user: (req as AuthedRequest).auth.sub }));

// Next.js App Router (app/api/things/route.ts)
export const GET = withAuth(oauth, (req, auth) => Response.json({ user: auth.sub }), { audience });

// Anything else
const out = await authenticate(oauth, request, { audience }); // from '@neon/oauth-client/adapter'
if (!out.ok) return out.response; // 401/403/503 with an RFC 6750 WWW-Authenticate
out.auth; // { token, sub, clientId, scopes, audience, expiresAt, claims }
```

Lower level: `oauth.requireBearerAuth({ audience })(request)` or `oauth.verifyAccessToken(token, { audience })` (throws `InvalidTokenError` with a `code`). The challenge has no `resource_metadata` by default; pass `resourceMetadataUrl: true` (derive from `audience`) or a URL.

### Sign users in

```ts
const { client } = oauth;

// Serves GET /auth/login (?returnTo=/path), /auth/callback, /auth/logout. `redirectUri` must be <origin>/auth/callback.
app.use(honoOAuthClient(client));                   // Hono
app.use(expressOAuthClient(client));                // Express
export const { GET } = createRouteHandlers(client); // Next: app/api/auth/[...oauth]/route.ts, redirectUri <origin>/api/auth/callback
// Any other: (await routeOAuthClient(client, request, { basePath: '/auth' })) ?? next()

const user = await client.getUser(request); // { id, email, emailVerified, name, image } | undefined
```

Pass `{ basePath: '' }` to serve at the root (`/login`, `/callback`, `/logout`), or another prefix. For plain `node:http`: `createServer(toNodeHandler(route))`.

Calling an API as the user: `const t = await client.getAccessToken(request)` returns `{ accessToken, setCookie? }`. If `setCookie` is present the token was refreshed; append it to your response as `Set-Cookie`. Set `resource` on `createOAuth` so the token's `aud` is your API.

## Quick start: protect an MCP server (`@neon/oauth-client/mcp`)

```ts
import { createMcpAuth } from '@neon/oauth-client/mcp';
import { honoMcp } from '@neon/oauth-client/hono';

const mcp = createMcpAuth({ baseUrl: process.env.NEON_AUTH_BASE_URL!, resource: 'http://localhost:3100/mcp' });

// Serves /.well-known/oauth-protected-resource/mcp (+ bare fallback, CORS) and guards POST/GET/DELETE /mcp.
honoMcp(app, mcp);
app.post('/mcp', (c) => transport.handleRequest(c.req.raw, { authInfo: mcp.toAuthInfo(c.get('auth')) }));
```

`resource` is the audience; 401/403 challenges include `resource_metadata` pointing at the path-inserted metadata URL. `scopesSupported` adds `scopes_supported` to the metadata. Verification options (`algorithms`, `clockTolerance`, `discovery`, `jwks`) are accepted alongside.

`@neon/oauth-client/mcp` also exports `McpResourceServer`, `toAuthInfo` (verified result to the MCP SDK's `AuthInfo`), `routeMcpMetadata` (for frameworks without an adapter), `InvalidTokenError` and `AuthServerUnavailableError`.

`createMcpAuth(opts)` is exactly `createOAuth({ baseUrl, ... }).mcp({ resource, scopesSupported })`. If the same app also signs users in or guards other APIs, call `oauth.mcp({ resource })` on your existing `oauth` instead, so everything shares one discovery cache.

Express: `app.use(expressMcp(mcp));` before `express.json()`, then `(req as AuthedRequest).auth` in the handler.

## Entry points

| Import | Provides |
|---|---|
| `@neon/oauth-client` | `createOAuth`, types (`OAuth`, `OAuthOptions`, `OAuthClient`, `AuthUser`, `AuthResult`, `McpResourceServer`), `InvalidTokenError`, `AuthServerUnavailableError` |
| `@neon/oauth-client/mcp` | `createMcpAuth`, `McpResourceServer`, `toAuthInfo`, `routeMcpMetadata`, `InvalidTokenError`, `AuthServerUnavailableError`, `AuthResult` |
| `@neon/oauth-client/hono` | `honoBearerAuth`, `honoMcp`, `honoProtectedResourceMetadata`, `honoOAuthClient` |
| `@neon/oauth-client/express` | `expressBearerAuth`, `expressMcp`, `expressOAuthClient` (`req.auth`) |
| `@neon/oauth-client/next` | `withAuth`, `createRouteHandlers`, `createMetadataHandlers` |
| `@neon/oauth-client/node` | `toNodeHandler`, `nodeBearerAuth`, `nodeMcp`, `nodeOAuthClient`, `nodeMiddleware` |
| `@neon/oauth-client/adapter` | The adapter contract: `authenticate`, `routeOAuthClient`, `routeMcpMetadata` |

Bun, Deno and Workers need no adapter. See [docs/ADAPTERS.md](docs/ADAPTERS.md), which is also the guide for **adding a framework**.

Consume with `"@neon/oauth-client": "file:../packages/oauth-client"`. Exports point at `dist/` (plain ESM + `.d.ts`), so it works under `tsx`, plain `node`, and `tsc`. Run `npm run build` here after editing (`npm run dev` rebuilds on save).

## Neon Auth notes

- **`resource` becomes `aud`.** The client sends `resource=<audience>` on authorize and token requests; the API must verify the same string. A mismatch rejects every call.
- **`iss` is per branch, keys are shared across branches.** The signature alone does not prove the branch, so `iss` is matched exactly, and discovery's `issuer` must equal the configured one.
- **`client_secret_basic` only.** Neon Auth rejects `client_secret_post` for confidential clients. Public clients use PKCE with no secret.
- **Profile comes from userinfo.** The ID token has no name/email, so the client calls the userinfo endpoint at login and stores the result in the session.
- **Tokens are EdDSA.** `algorithms` defaults to `['EdDSA']`.
- **Session lives in the cookie.** AES-256-GCM (`dir`) JWE, key derived with HKDF-SHA-256 from `cookies.secret`; HttpOnly, SameSite=Lax, `Secure` unless the redirect URI is `http://localhost`. A warning is logged if it passes ~3.8 KB. Rotating `cookies.secret` signs everyone out.
- **Logout is local.** It clears this app's cookie; it does not end the Neon Auth session.

## Develop

```
npm install
npm test          # vitest; uses a real local HTTP server as a fake Neon Auth
npm run typecheck
npm run build
```
