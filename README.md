# Neon Auth OAuth provider + MCP demos

Demo apps for Neon Auth's OAuth provider and MCP support: a login/consent host, an MCP resource server, an OAuth client app, an SDK-based client, an end-to-end test, and a prototype of the shared OAuth helper library.

| Dir | What it is | Port |
|---|---|---|
| `neon-auth-mcp-demo` | Next.js app: login page, OAuth consent page, todo UI | 31099 |
| `neon-mcp-server-demo` | Hono MCP server (OAuth-protected resource) exposing todo tools | 31100 |
| `neon-oauth-reports-demo` | Confidential OAuth client app that calls a protected API | 31101 |
| `neon-mcp-sdk-client` | CLI MCP client built on `@modelcontextprotocol/sdk` (auth code + PKCE) | - |
| `neon-mcp-e2e-test` | Scripted end-to-end run of the MCP OAuth flow | - |
| `packages/oauth` | `@neon/oauth`: vendored copy of the SDK (client login, token verification, MCP resource-server auth, framework adapters) | - |

## Architecture

```
 MCP client (SDK client / Cursor / e2e test)
        |  1. POST /mcp -> 401 + resource_metadata
        v
 neon-mcp-server-demo :31100 --- protected-resource metadata ---> issuer URL
        ^                                                            |
        | 5. Bearer token (aud = MCP resource)                       v
        |                                                      Neon Auth (OAuth provider)
        |                         2. /authorize  ->  login + consent pages
        |                                                            |
        +---------------------------- 4. token <---------------------+
                                                                     |
                                   neon-auth-mcp-demo :31099  <------+ 3. login / consent UI

 neon-oauth-reports-demo :31101 --- confidential client (auth code) ---> Neon Auth
```

The login and consent pages are served by `neon-auth-mcp-demo`; Neon Auth redirects there during `/authorize`. The MCP server verifies tokens against the issuer's JWKS. The todo data lives in a `public.todos` table in the same Neon project.

## Quick start

1. In the Neon Console, for your project's auth settings, configure the OAuth provider:
   - add `http://localhost:31099` as a trusted domain;
   - set the login and consent page URLs to the `neon-auth-mcp-demo` app (`/login`, `/consent`);
   - enable MCP and set the MCP resource to `http://localhost:31100/mcp`;
   - register a protected resource for the reports app (`http://localhost:31101/api`);
   - create a confidential OAuth client for `neon-oauth-reports-demo` with redirect URI `http://localhost:31101/callback`, and note its client ID and secret.
2. Create a `public.todos` table and a least-privilege database role for the demos (read/write on `public.todos` only).
3. Copy each example env file and fill in your values:
   - `neon-auth-mcp-demo/.env.local.example` -> `.env.local`
   - `neon-mcp-server-demo/.env.example` -> `.env`
   - `neon-oauth-reports-demo/.env.example` -> `.env`
4. In each app directory, run `npm install` and `npm run dev`. The SDK client uses `npm start`; the e2e test uses `npm run test:e2e`.

The dev scripts set `NODE_TLS_REJECT_UNAUTHORIZED=0` because a local Neon Auth serves a self-signed certificate. Do not use that setting outside local development. See `LOCAL-SETUP.md` for the port and env map.

## Status

`packages/oauth` is a vendored copy of `@neon/oauth` from [neondatabase/neon-pkgs#869](https://github.com/neondatabase/neon-pkgs/pull/869) (commit `4e32332da4`), kept here until the package is published. It differs from the source only in standalone build config (`catalog:` versions replaced, tests removed, and `types` pointed at `dist/index2.d.ts`, `adapter2.d.ts`, `node2.d.ts` because the build emits the public declarations under those names). Build it with `cd packages/oauth && npm install && npm run build`; the demos link it via `"@neon/oauth": "file:../packages/oauth"`.

Once `@neon/oauth` is on npm, switch each demo with `npm install @neon/oauth@<version>` (replacing the `file:` link) and delete `packages/oauth`. No import changes are needed.
