# OAuth in this demo

Moved to the shared package: see [`packages/oauth-client/README.md`](../../../packages/oauth-client/README.md).
`src/index.ts` is the whole integration: `createOAuth({ baseUrl, clientId, ..., cookies })`, `routeOAuthClient(oauth.client, request, { basePath: '' })` for `/login`, `/callback`, `/logout`, `getAccessToken`/`getUser` for the dashboard, and `authenticate(oauth, request, { audience })` for `/api/reports`; its 401 carries a plain RFC 6750 `WWW-Authenticate` with no `resource_metadata`.

Env: see `.env.example` (`NEON_AUTH_ISSUER` is passed as `baseUrl`; `COOKIE_SECRET` is optional, unset means sessions reset on restart).
