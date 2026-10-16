# OAuth in this demo

Moved to the shared package: see [`packages/oauth/README.md`](../../../packages/oauth/README.md).
`src/index.ts` is the whole integration: `createOAuth({ baseUrl }).mcp({ resource })` + `app.use(honoMcp(mcp))` (metadata routes and bearer guard in one middleware) + `c.get('authInfo')` (typed via `McpAuthVariables`).

Config is passed explicitly (`src/config.ts`, from `.env`): `NEON_AUTH_ISSUER` becomes `baseUrl`, and `MCP_RESOURCE` (this server's URL; must equal Neon Auth's `NEON_AUTH_MCP_RESOURCE`) becomes `resource`.
