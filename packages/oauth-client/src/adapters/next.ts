// Next.js App Router adapters. Route handlers are already Web Request -> Response, so these are thin.
import type { BearerAuthOptions } from '../bearer.js';
import { authenticate, routeMcpMetadata, routeOAuthClient } from './core.js';
import type { AuthResult, McpResourceServer, OAuth, OAuthBearerOptions, OAuthClient } from './core.js';

export type AuthedHandler<C> = (request: Request, auth: AuthResult, routeContext: C) => Response | Promise<Response>;

/** Wraps a route handler: 401/403/503 is returned for you, otherwise the handler runs with the verified `AuthResult`. */
export function withAuth<C = unknown>(source: McpResourceServer, handler: AuthedHandler<C>, opts?: BearerAuthOptions): (request: Request, routeContext: C) => Promise<Response>;
export function withAuth<C = unknown>(source: OAuth, handler: AuthedHandler<C>, opts: OAuthBearerOptions): (request: Request, routeContext: C) => Promise<Response>;
export function withAuth<C>(source: McpResourceServer | OAuth, handler: AuthedHandler<C>, opts: BearerAuthOptions | OAuthBearerOptions = {}) {
  return async (request: Request, routeContext: C): Promise<Response> => {
    const outcome = await authenticate(source as OAuth, request, opts as OAuthBearerOptions);
    return outcome.ok ? handler(request, outcome.auth, routeContext) : outcome.response;
  };
}

/**
 * For `app/api/auth/[...oauth]/route.ts`: `export const { GET } = createRouteHandlers(oauth.client)`.
 * `basePath` is the route's URL prefix (default `/api/auth`); `redirectUri` must be `<origin>${basePath}/callback`.
 */
export function createRouteHandlers(client: OAuthClient, opts: { basePath?: string } = {}) {
  const basePath = opts.basePath ?? '/api/auth';
  return {
    GET: async (request: Request): Promise<Response> =>
      (await routeOAuthClient(client, request, { basePath })) ?? new Response('Not found', { status: 404 }),
  };
}

/**
 * For the RFC 9728 well-known routes, which Next serves outside `/api`:
 * `app/.well-known/oauth-protected-resource/[[...path]]/route.ts` with `export const { GET, OPTIONS } = createMetadataHandlers(mcp)`.
 */
export function createMetadataHandlers(mcp: McpResourceServer) {
  const handle = (request: Request): Response => routeMcpMetadata(mcp, request) ?? new Response('Not found', { status: 404 });
  return { GET: handle, OPTIONS: handle };
}
