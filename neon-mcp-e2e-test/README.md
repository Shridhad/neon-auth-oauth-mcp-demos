# neon-mcp-e2e-test

Automated, re-runnable end-to-end test of the MCP OAuth flow against the local Neon Auth
authorization server (`https://<root-endpointId>.neonauth.localtest.me:30443/neondb/auth`)
and the local MCP resource server (`http://localhost:31100/mcp`). It plays the role of an MCP
client (Cursor) over plain HTTP: RFC 9728 protected-resource discovery -> AS metadata discovery
-> anonymous DCR -> sign-in -> `/oauth2/authorize` -> `/oauth2/consent` -> `/oauth2/token` ->
an authenticated MCP `initialize` + `tools/call whoami`. Each hop is logged PASS/FAIL with the
HTTP status and a response snippet, so a failure pinpoints exactly which hop broke.

## Run it

```
npm install
npm run test:e2e
```

Requires the local stack (neon-auth, the MCP resource server on :31100) to already be running.
Uses `NODE_TLS_REJECT_UNAUTHORIZED=0` (baked into the npm script) to talk to neon-auth's
self-signed local TLS cert.

## Re-runnability

- Uses a fixed test user (`E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` env vars, defaulting to
  `e2e-oauth-test@example.com`). The first run signs the user up; subsequent runs sign in.
- Registers a fresh OAuth client via DCR on every run (DCR is meant to be called repeatedly by
  real clients, so there's no reason to cache a client_id across runs).
- Uses a loopback redirect_uri (`http://127.0.0.1:33418/callback`) with no listener on that
  port -- the authorization code is read directly out of the JSON response bodies that
  `/oauth2/authorize` and `/oauth2/consent` return (see "Wire quirks" below), not by receiving
  an actual browser redirect.

## Wire quirks worth knowing before editing this script

- `/oauth2/authorize` only sends a real HTTP 302 for browser-navigation-shaped requests
  (`Sec-Fetch-Mode: navigate` or an `Accept` header containing `text/html`). Any other request
  -- including a plain `fetch()` call, which always sends `Accept: */*` -- gets the same
  redirect decision back as a `200 OK` JSON body: `{"redirect": true, "url": "..."}`. Step 6
  handles both shapes.
- Dynamic client registration defaults an unspecified `application_type` to `"web"`, and `"web"`
  clients are required to use HTTPS on a non-loopback host. A loopback `redirect_uri` needs
  `application_type: "native"` set explicitly in the DCR request body, or registration will
  later reject the redirect_uri at `/oauth2/authorize` time.
- `/oauth2/consent` takes the exact query string from the `/oauth2/authorize` redirect
  (everything after `?`, still percent-encoded) back as the `oauth_query` field of its JSON
  body -- it's a signed round-trip, not just informational.

## Known blocker: step 8 (token exchange) fails locally

As of this writing, hop 8 fails with `415 {"code":"FST_ERR_CTP_INVALID_MEDIA_TYPE"}` on every
run. This is **not** the login/consent-continuation gap (hops 1-7 all pass, including a fully
automated consent decision) -- it's a separate, lower-level issue: the OAuth spec requires
`/oauth2/token` requests to use `Content-Type: application/x-www-form-urlencoded` (and
neon-auth's own route metadata enforces exactly that), but the Fastify server that hosts the
`/:database/auth/*` catch-all route has no body parser registered for that content type, so
Fastify rejects the request before it ever reaches the route handler. Every other content type
(`application/json`, `text/plain`) reaches the handler but is then rejected by neon-auth's own
`allowedMediaTypes` check. No Content-Type value can currently succeed -- this blocks token
exchange for any client, not just this script. See the PR/commit description for exact
file:line pointers into `neon-auth/src/servers/common.ts` and `neon-auth/src/api/auth/index.ts`.

Hop 9 (calling the MCP resource) is implemented but will report `SKIPPED` until hop 8 is fixed,
since there's no access token to send.
