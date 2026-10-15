// node:http adapters.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BearerAuthOptions } from '../bearer.js';
import { authenticate, MCP_METHODS, mcpPath, routeMcpMetadata, routeOAuthClient } from './core.js';
import type { AuthResult, McpResourceServer, OAuth, OAuthBearerOptions, OAuthClient, OAuthRouteOptions } from './core.js';
import { sendWebResponse, toWebRequest } from './node-http.js';

export type FetchHandler = (request: Request) => Response | Promise<Response>;
export type NodeNext = (err?: unknown) => void;
export type NodeMiddleware = (req: IncomingMessage, res: ServerResponse, next: NodeNext) => void;
export type AuthedIncomingMessage = IncomingMessage & { auth?: AuthResult };

/** Adapts a Request->Response handler (such as `client.handlers.login`) to a plain `node:http` listener. */
export function toNodeHandler(handler: FetchHandler): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => sendWebResponse(res, await handler(toWebRequest(req)));
}

/** Runs `step` on the converted request; a returned Response is sent, `undefined` calls `next`. Errors go to `next(err)`. */
export function nodeMiddleware(step: (request: Request, req: IncomingMessage) => Promise<Response | undefined> | Response | undefined): NodeMiddleware {
  return (req, res, next) => {
    // Headers and URL only: a framework body parser may have consumed the stream already.
    Promise.resolve(step(toWebRequest(req, { body: false }), req)).then(
      (response) => (response ? sendWebResponse(res, response) : next()),
      next,
    );
  };
}

/** Bearer guard. On success the verified `AuthResult` is at `req.auth` and `next()` is called. */
export function nodeBearerAuth(source: McpResourceServer, opts?: BearerAuthOptions): NodeMiddleware;
export function nodeBearerAuth(source: OAuth, opts: OAuthBearerOptions): NodeMiddleware;
export function nodeBearerAuth(source: McpResourceServer | OAuth, opts: BearerAuthOptions | OAuthBearerOptions = {}): NodeMiddleware {
  return nodeMiddleware(async (request, req) => {
    const outcome = await authenticate(source as OAuth, request, opts as OAuthBearerOptions);
    if (!outcome.ok) return outcome.response;
    (req as AuthedIncomingMessage).auth = outcome.auth;
    return undefined;
  });
}

export interface NodeMcpOptions extends BearerAuthOptions {
  /** MCP endpoint path. Defaults to the path of `resource`. */
  path?: string;
}

/** Serves the metadata routes and guards POST/GET/DELETE on the MCP path. Everything else calls `next()`. */
export function nodeMcp(mcp: McpResourceServer, opts: NodeMcpOptions = {}): NodeMiddleware {
  const { path, ...bearer } = opts;
  const target = mcpPath(mcp, path);
  const guard = nodeBearerAuth(mcp, bearer);
  const metadata = nodeMiddleware((request) => routeMcpMetadata(mcp, request));
  return (req, res, next) =>
    metadata(req, res, (err) => {
      if (err) return next(err);
      const { pathname } = new URL((req as { originalUrl?: string }).originalUrl ?? req.url ?? '/', 'http://localhost');
      if (pathname === target && (MCP_METHODS as readonly string[]).includes(req.method ?? '')) return guard(req, res, next);
      next();
    });
}

/** Serves `${basePath}/login|callback|logout`; everything else calls `next()`. */
export function nodeOAuthClient(client: OAuthClient, opts?: OAuthRouteOptions): NodeMiddleware {
  return nodeMiddleware((request) => routeOAuthClient(client, request, opts));
}
