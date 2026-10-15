import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpAuth } from '@neon/oauth-client/mcp';
import type { AuthResult } from '@neon/oauth-client/mcp';
import { honoMcp } from '@neon/oauth-client/hono';

import { MCP_RESOURCE, NEON_AUTH_ISSUER, PORT } from './config.js';
import { createMcpServer } from './mcpServer.js';

const mcp = createMcpAuth({ baseUrl: NEON_AUTH_ISSUER, resource: MCP_RESOURCE });

/**
 * Runs the MCP server for a verified request. Stateless mode (a fresh server
 * + transport per request, per the SDK's own Fetch-native example) so there's
 * no session to route follow-up requests to and no shared state between
 * callers. Only POST carries MCP requests; GET/DELETE are still routed here
 * (so the bearer token is verified before any error is returned) but 405 —
 * this demo only supports stateless POST.
 */
async function handleMcpRequest(request: Request, authInfo: AuthInfo): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed. This server only supports stateless POST /mcp.' },
        id: null,
      },
      { status: 405, headers: { Allow: 'POST' } },
    );
  }

  // A verified token without a subject has no user to scope todos to.
  const claims = authInfo.extra?.claims as { sub?: unknown };
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32001, message: 'Access token has no subject (sub) claim.' }, id: null },
      { status: 403 },
    );
  }

  const server = createMcpServer(claims.sub);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request, { authInfo });
}

const app = new Hono();

// Request logging: without it a client that fails to connect leaves no trace
// here, making "the client can't reach us" indistinguishable from "we rejected
// it". Logs every request's method, path, status and the presence of a bearer
// token (never the token itself). Tagged mcp-demo-request-log.
app.use('*', async (c, next) => {
  const started = Date.now();
  const hasAuth = c.req.header('authorization') !== undefined;
  await next();
  const line = [
    new Date().toISOString(),
    c.req.method,
    new URL(c.req.url).pathname,
    `-> ${c.res.status}`,
    hasAuth ? 'bearer=yes' : 'bearer=no',
    `${Date.now() - started}ms`,
    `ua=${(c.req.header('user-agent') ?? '-').slice(0, 60)}`,
  ].join(' ');
  console.log(line);
});

// Mounts the unauthenticated protected-resource metadata (MCP clients discover the AS through it
// before they have a token) and the bearer guard on POST/GET/DELETE /mcp.
honoMcp(app, mcp);

const mcpRoute = (c: Context<{ Variables: { auth: AuthResult } }>) => handleMcpRequest(c.req.raw, mcp.toAuthInfo(c.get('auth')));

app.post('/mcp', mcpRoute);
app.get('/mcp', mcpRoute);
app.delete('/mcp', mcpRoute);

serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`neon-mcp-server-demo listening on http://localhost:${info.port}`);
  console.log(`  MCP endpoint:              http://localhost:${info.port}/mcp`);
  console.log(
    `  Protected-resource metadata: http://localhost:${info.port}${new URL(mcp.resourceMetadataUrl).pathname}`,
  );
});
