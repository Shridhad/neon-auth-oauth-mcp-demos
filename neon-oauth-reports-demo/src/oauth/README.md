# OAuth in this demo

Moved to the shared package: see [`packages/oauth/README.md`](../../../packages/oauth/README.md).
`src/index.ts` is the whole integration: `createOAuth({ baseUrl, clientId, ..., cookies })`, `routeOAuthClient(oauth.client, request)` for `/login`, `/callback`, `/logout` (the prefix is derived from the `/callback` redirect URI), `getAccessToken` (a `{ ok, ... }` result) / `getUser` for the dashboard, and `authenticate(oauth, request, { audience })` for `/api/reports`; its 401 carries a plain RFC 6750 `WWW-Authenticate` with no `resource_metadata`.

Env: see `.env.example` (`NEON_AUTH_ISSUER` is passed as `baseUrl`; `COOKIE_SECRET` is optional, unset means sessions reset on restart).
