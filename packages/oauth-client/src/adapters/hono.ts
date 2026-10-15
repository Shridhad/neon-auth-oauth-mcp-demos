// Hono adapters. Type-only imports: Hono is needed at runtime only by the app using them.
import type { Hono, MiddlewareHandler } from 'hono';

import type { BearerAuthOptions } from '../bearer.js';
import { authenticate, MCP_METHODS, mcpPath, routeMcpMetadata, routeOAuthClient } from './core.js';
import type { AuthResult, McpResourceServer, OAuth, OAuthBearerOptions, OAuthClient, OAuthRouteOptions } from './core.js';

export type AuthVariables = { Variables: { auth: AuthResult } };

/** Bearer guard for any route. On success the verified `AuthResult` is at `c.get('auth')`. */
export function honoBearerAuth(source: McpResourceServer, opts?: BearerAuthOptions): MiddlewareHandler<AuthVariables>;
export function honoBearerAuth(source: OAuth, opts: OAuthBearerOptions): MiddlewareHandler<AuthVariables>;
export function honoBearerAuth(
  source: McpResourceServer | OAuth,
  opts: OAuthBearerOptions | BearerAuthOptions = {},
): MiddlewareHandler<AuthVariables> {
  return async (c, next) => {
    const outcome = await authenticate(source as OAuth, c.req.raw, opts as OAuthBearerOptions);
    if (!outcome.ok) return outcome.response;
    c.set('auth', outcome.auth);
    await next();
  };
}

/** Serves the RFC 9728 metadata (path-inserted and bare) plus its CORS preflight. Unauthenticated by design. */
export function honoProtectedResourceMetadata(app: Hono, mcp: McpResourceServer): void {
  for (const path of mcp.metadataPaths) {
    app.on(['GET', 'OPTIONS'], path, (c) => routeMcpMetadata(mcp, c.req.raw)!);
  }
}

export interface HonoMcpOptions extends BearerAuthOptions {
  /** MCP endpoint path. Defaults to the path of `resource`. */
  path?: string;
}

/**
 * One call to protect an MCP endpoint: mounts the metadata routes and a bearer guard on
 * POST/GET/DELETE of the MCP path (the Streamable HTTP methods). Register your handlers after it;
 * read the verified token with `c.get('auth')` and pass `mcp.toAuthInfo(...)` to the SDK transport.
 */
export function honoMcp(app: Hono, mcp: McpResourceServer, opts: HonoMcpOptions = {}): void {
  const { path, ...bearer } = opts;
  honoProtectedResourceMetadata(app, mcp);
  app.on([...MCP_METHODS], mcpPath(mcp, path), honoBearerAuth(mcp, bearer));
}

/** Serves `${basePath}/login|callback|logout`; other requests fall through. Mount with `app.use(honoOAuthClient(client))`. */
export function honoOAuthClient(client: OAuthClient, opts?: OAuthRouteOptions): MiddlewareHandler {
  return async (c, next) => (await routeOAuthClient(client, c.req.raw, opts)) ?? next();
}
