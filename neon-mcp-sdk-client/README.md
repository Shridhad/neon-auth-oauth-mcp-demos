# neon-mcp-sdk-client

Scripted MCP client using the official `@modelcontextprotocol/sdk` (1.32.1) OAuth support
(`OAuthClientProvider` + `StreamableHTTPClientTransport`): RFC 9728 discovery, AS metadata, DCR, PKCE.

## Run
```
npm install
npm start
```
Env: `MCP_RESOURCE_URL` (default `http://localhost:31100/mcp`), `FRESH=0` to reuse saved client/tokens.
`NODE_TLS_REJECT_UNAUTHORIZED=0` is baked into `npm start`.

The script prints the authorize URL and writes it to `/tmp/neon-mcp-sdk-client/authorize-url.txt`, then
listens on `http://127.0.0.1:33418/callback` for up to 10 minutes. Open the URL in a browser (sign in/consent);
the script then finishes auth, lists tools, and calls `whoami` and `list_todos`, printing PASS/FAIL per step.
State is persisted to `/tmp/neon-mcp-sdk-client/state.json` (deleted at start unless `FRESH=0`).
