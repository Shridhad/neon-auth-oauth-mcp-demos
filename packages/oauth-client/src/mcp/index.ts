// Entry point for MCP servers: everything needed to protect an MCP endpoint, and nothing about sign-in.
import { createOAuth } from '../index.js';
import type { OAuthOptions } from '../index.js';
import type { McpOptions, McpResourceServer } from './resource-server.js';

export { routeMcpMetadata } from '../adapters/core.js';
export { AuthServerUnavailableError, InvalidTokenError } from '../errors.js';
export type { InvalidTokenCode } from '../errors.js';
export type { AuthResult } from '../issuer.js';
export type { BearerAuthOptions } from '../bearer.js';
export { toAuthInfo } from './resource-server.js';
export type { McpOptions, McpResourceServer } from './resource-server.js';

/** The verification options of `createOAuth`; the sign-in client settings do not apply to a resource server. */
export type McpAuthOptions = McpOptions & Pick<OAuthOptions, 'baseUrl' | 'algorithms' | 'clockTolerance' | 'discovery' | 'jwks'>;

/**
 * An MCP server protected by the Neon Auth issuer at `baseUrl`. Identical to
 * `createOAuth({ baseUrl, ... }).mcp({ resource, scopesSupported })`; use that form instead when the
 * same app also needs `oauth.client` or `oauth.requireBearerAuth`, so they share one discovery cache.
 */
export function createMcpAuth({ resource, scopesSupported, ...oauthOptions }: McpAuthOptions): McpResourceServer {
  return createOAuth(oauthOptions).mcp({ resource, scopesSupported });
}
