# OAuth in this demo

Moved to the shared package: see [`packages/oauth-client/README.md`](../../../packages/oauth-client/README.md).
`src/index.ts` is the whole integration: `createOAuth({ baseUrl }).mcp({ resource })` + `honoMcp(app, mcp)` (metadata routes and bearer guard in one call) + `mcp.toAuthInfo`.

Config is passed explicitly (`src/config.ts`, from `.env`): `NEON_AUTH_ISSUER` becomes `baseUrl`, and `MCP_RESOURCE` (this server's URL; must equal Neon Auth's `NEON_AUTH_MCP_RESOURCE`) becomes `resource`.
