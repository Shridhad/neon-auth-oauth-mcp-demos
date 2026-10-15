// The contract every framework adapter is built on. All three functions speak Web `Request`/`Response`;
// an adapter only converts its framework's request/response to and from these, then calls them.
// Adapters must not reimplement routing, challenges or metadata.
import type { BearerAuthOptions } from '../bearer.js';
import type { OAuthClient } from '../client/index.js';
import type { OAuth, OAuthBearerOptions } from '../index.js';
import type { AuthResult } from '../issuer.js';
import type { McpResourceServer } from '../mcp/resource-server.js';

export type { AuthResult, McpResourceServer, OAuth, OAuthBearerOptions, OAuthClient };

export type AuthOutcome = { ok: true; auth: AuthResult } | { ok: false; response: Response };

/** Verifies the request's bearer token. On failure `response` is a ready 401/403/503 to send as-is. */
export function authenticate(source: McpResourceServer, request: Request, opts?: BearerAuthOptions): Promise<AuthOutcome>;
export function authenticate(source: OAuth, request: Request, opts: OAuthBearerOptions): Promise<AuthOutcome>;
export async function authenticate(
  source: McpResourceServer | OAuth,
  request: Request,
  opts: BearerAuthOptions | OAuthBearerOptions = {},
): Promise<AuthOutcome> {
  const result = await (source as OAuth).requireBearerAuth(opts as OAuthBearerOptions)(request);
  return result instanceof Response ? { ok: false, response: result } : { ok: true, auth: result };
}

export interface OAuthRouteOptions {
  /**
   * Path prefix for `/login`, `/callback` and `/logout`. Defaults to `/auth`, a dedicated namespace that cannot
   * collide with app routes. Use `''` to serve them at the root. `redirectUri` must point at `${basePath}/callback`.
   */
  basePath?: string;
}

/** Handles GET `${basePath}/login|callback|logout`; `undefined` for anything else so the caller keeps routing. */
export async function routeOAuthClient(client: OAuthClient, request: Request, opts: OAuthRouteOptions = {}): Promise<Response | undefined> {
  if (request.method !== 'GET') return undefined;
  const prefix = (opts.basePath ?? '/auth').replace(/\/$/, '');
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(`${prefix}/`)) return undefined;
  const action = pathname.slice(prefix.length + 1);
  if (action === 'login' || action === 'callback' || action === 'logout') return client.handlers[action](request);
  return undefined;
}

/** GET/OPTIONS on the RFC 9728 metadata paths; `undefined` for anything else. */
export function routeMcpMetadata(mcp: McpResourceServer, request: Request): Response | undefined {
  return mcp.handleMetadataRequest(request);
}

/** Streamable HTTP methods the MCP endpoint is guarded on. */
export const MCP_METHODS = ['POST', 'GET', 'DELETE'] as const;

/** The MCP endpoint path: `path` if given, else the path of the resource URL. */
export const mcpPath = (mcp: McpResourceServer, path?: string): string => path ?? new URL(mcp.resource).pathname;
