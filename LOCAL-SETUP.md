# Local demo setup

One Neon project holds users, todos and OAuth clients. Issuer / base URL:
`https://<root-endpointId>.neonauth.localtest.me:30443/neondb/auth`

| Port | App | Dir | Config |
|---|---|---|---|
| 31099 | login/consent + todo UI (Next.js) | neon-auth-mcp-demo | `.env.local`: NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET, TODOS_DATABASE_URL |
| 31100 | MCP server | neon-mcp-server-demo | `.env`: NEON_AUTH_ISSUER, MCP_RESOURCE, TODOS_DATABASE_URL |
| 31101 | Reports (OAuth client) | neon-oauth-reports-demo | `.env`: NEON_AUTH_ISSUER, REPORTS_CLIENT_ID/SECRET, REPORTS_RESOURCE, COOKIE_SECRET |

The e2e harness (neon-mcp-e2e-test) and SDK client (neon-mcp-sdk-client) discover the issuer from the MCP server's protected-resource metadata; they need no config.

Start each app with `cd <dir> && npm run dev` (the SDK client uses `npm start`, the e2e test `npm run test:e2e`).

OAuth provider config is set through the Console API
(`PATCH /api/v2/projects/<project-id>/branches/<branch-id>/auth/plugins/oauth-provider`).

MCP clients such as Cursor must log out and re-authorize if the issuer changes.
