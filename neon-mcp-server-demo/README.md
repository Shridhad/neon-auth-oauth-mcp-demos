# neon-mcp-server-demo

Minimal MCP server that acts as the **OAuth-protected resource server** in
the Neon Auth MCP flow. It exposes one MCP tool (`whoami`) behind a bearer
token, and validates that token against a local **neon-auth** instance
acting as the authorization server (AS). Neon Functions would normally play
this resource-server role in production; this stands in for it locally.

## How it fits together

1. An MCP client (e.g. `@modelcontextprotocol/inspector`) calls `POST /mcp`
   here with no token.
2. This server replies `401` with a `WWW-Authenticate: Bearer
   resource_metadata="http://localhost:31100/.well-known/oauth-protected-resource"`
   header (RFC 9728 challenge).
3. The client fetches that metadata, discovers neon-auth's AS issuer, and
   runs the OAuth authorization-code + PKCE flow against neon-auth — with
   login/consent served by the **other** demo app,
   [`neon-auth-mcp-demo`](../neon-auth-mcp-demo), on `:31099`.
4. neon-auth issues an `at+jwt` access token audience-bound to this server's
   MCP resource URL.
5. The client retries `POST /mcp` with `Authorization: Bearer <token>`.
   `src/oauth/verify.ts` verifies the
   token's signature (via the AS's JWKS), issuer, audience, and expiry, then
   this server runs the `whoami` tool, which just echoes back the verified
   claims — proving the flow worked end to end.

## Prerequisites

- A neon-auth server with the MCP OAuth provider enabled (`NEON_AUTH_MCP_ENABLED=true`, plus `NEON_AUTH_MCP_RESOURCE`,
  `NEON_AUTH_MCP_LOGIN_PAGE`, `NEON_AUTH_MCP_CONSENT_PAGE` set — see
  `neon-auth/src/config.ts` and `neon-auth/src/auth/auth.ts`).
- [`neon-auth-mcp-demo`](../neon-auth-mcp-demo) running on `:31099` for
  login/consent.
- The root `endpointId` of the Neon project neon-auth is running against
  (same one both demo apps need).

## Configure

```bash
cp .env.example .env
```

Fill in `.env`:

- `NEON_AUTH_ISSUER` — e.g.
  `https://<root-endpointId>.neonauth.localtest.me:30443/neondb/auth`
- `MCP_RESOURCE` — `http://localhost:31100/mcp`. **This must be byte-identical
  to neon-auth's `NEON_AUTH_MCP_RESOURCE`** — tokens are audience-bound to
  that exact string, and this server checks incoming tokens' `aud` against
  this value. A mismatch (trailing slash, `https` vs `http`, wrong port)
  means every call 403s.
- `PORT` — `31100` (must match the port in `MCP_RESOURCE`).

## Run

```bash
npm install
npm run dev
```

### Local TLS note

Local neon-auth's `:30443` endpoint uses a self-signed cert. This server
fetches AS discovery and JWKS documents from it server-side, so it needs
`NODE_TLS_REJECT_UNAUTHORIZED=0` to accept that cert — already wired into
`npm run dev` / `npm run start`. **Dev-only** — don't carry this into
anything that talks to a real, non-self-signed neon-auth.

## Drive it end to end

```bash
npx @modelcontextprotocol/inspector
```

Point the Inspector at `http://localhost:31100/mcp` (Streamable HTTP
transport). It will hit the endpoint unauthenticated, follow the RFC 9728
challenge to discover neon-auth, and open the OAuth authorization flow in
your browser — which lands on the other demo app's `/login` (and eventually
`/consent`). Once authorized, call the `whoami` tool from the Inspector's
tool list and confirm it returns your session's claims.

## Scope

One tool, TypeScript, minimal dependencies (`hono`, `@modelcontextprotocol/sdk`,
`jose`). `src/oauth/middleware.ts` is a small hono port of the SDK's Express-only
`requireBearerAuth`: it verifies the bearer JWT with `jose` (exact issuer,
`aud === MCP_RESOURCE`, signature via the issuer's discovered `jwks_uri`) and
emits the RFC 6750 / RFC 9728 `WWW-Authenticate` challenge using the SDK's own
error classes and `getOAuthProtectedResourceMetadataUrl`.
`src/oauth/metadata.ts` serves the RFC 9728 protected-resource metadata
document. No test suite, no persistent sessions (stateless Streamable HTTP —
a fresh MCP server per request).
