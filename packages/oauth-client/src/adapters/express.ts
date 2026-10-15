// Express adapters, built on the node helpers. Type-only imports: Express is needed at runtime only by the app.
import type { Request, RequestHandler } from 'express';

import type { BearerAuthOptions } from '../bearer.js';
import type { AuthResult, McpResourceServer, OAuth, OAuthBearerOptions, OAuthClient, OAuthRouteOptions } from './core.js';
import { nodeBearerAuth, nodeMcp, nodeOAuthClient } from './node.js';
import type { NodeMcpOptions } from './node.js';

/** A request that has passed `expressBearerAuth` / `expressMcp`. */
export type AuthedRequest = Request & { auth: AuthResult };

/** Bearer guard for any route. On success the verified `AuthResult` is at `req.auth`. */
export function expressBearerAuth(source: McpResourceServer, opts?: BearerAuthOptions): RequestHandler;
export function expressBearerAuth(source: OAuth, opts: OAuthBearerOptions): RequestHandler;
export function expressBearerAuth(source: McpResourceServer | OAuth, opts: BearerAuthOptions | OAuthBearerOptions = {}): RequestHandler {
  return nodeBearerAuth(source as OAuth, opts as OAuthBearerOptions);
}

/**
 * Protects an MCP endpoint with one `app.use(...)`: serves the metadata routes and guards POST/GET/DELETE on
 * the MCP path. Register the MCP handler after it and read `(req as AuthedRequest).auth`.
 * Mount it before `express.json()`, or the transport cannot read the request body.
 */
export function expressMcp(mcp: McpResourceServer, opts?: NodeMcpOptions): RequestHandler {
  return nodeMcp(mcp, opts);
}

/** Serves `${basePath}/login|callback|logout`; other requests fall through. */
export function expressOAuthClient(client: OAuthClient, opts?: OAuthRouteOptions): RequestHandler {
  return nodeOAuthClient(client, opts);
}
