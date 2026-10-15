// MCP flavour of a protected resource: the MCP endpoint URL is the audience, challenges carry
// `resource_metadata`, and the RFC 9728 metadata document is served for MCP client discovery.
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { createBearerGuard, protectedResourceMetadataUrl } from '../bearer.js';
import type { BearerAuthOptions } from '../bearer.js';
import type { AuthResult, Issuer } from '../issuer.js';

export interface McpOptions {
  /** Public URL of the MCP endpoint, e.g. `https://host/mcp`. Clients send it as `resource`; it becomes the token `aud`. */
  resource: string;
  /** Scopes advertised as `scopes_supported` in the metadata document. */
  scopesSupported?: string[];
}

/** Maps a verified result to the MCP SDK's `AuthInfo`; claims are kept under `extra.claims`. */
export function toAuthInfo(result: AuthResult): AuthInfo {
  return {
    token: result.token,
    clientId: result.clientId,
    scopes: result.scopes,
    expiresAt: result.expiresAt,
    resource: result.audience[0] ? new URL(result.audience[0]) : undefined,
    extra: { claims: result.claims },
  };
}

export type McpResourceServer = ReturnType<typeof createMcp>;

const WELL_KNOWN_BARE = '/.well-known/oauth-protected-resource';

// Browser-based MCP clients fetch the metadata cross-origin before they have a token.
const CORS = { 'access-control-allow-origin': '*' };

export function createMcp(issuer: Issuer, { resource, scopesSupported }: McpOptions) {
  const resourceMetadataUrl = protectedResourceMetadataUrl(resource);
  // The path-inserted URL is canonical; the bare path is a fallback for clients that probe the root.
  const metadataPaths = [...new Set([new URL(resourceMetadataUrl).pathname, WELL_KNOWN_BARE])];

  /** RFC 9728 body. */
  function protectedResourceMetadata() {
    return { resource, authorization_servers: [issuer.issuer], ...(scopesSupported && { scopes_supported: scopesSupported }) };
  }

  /**
   * Framework-neutral metadata endpoint: a `Response` for GET/OPTIONS on the metadata paths,
   * otherwise `undefined` so the caller continues routing.
   */
  function handleMetadataRequest(request: Request): Response | undefined {
    if (!metadataPaths.includes(new URL(request.url).pathname)) return undefined;
    if (request.method === 'GET') return Response.json(protectedResourceMetadata(), { headers: CORS });
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' },
      });
    }
    return undefined;
  }

  return {
    issuer: issuer.issuer,
    resource,
    resourceMetadataUrl,
    metadataPaths,
    verifyAccessToken: (token: string) => issuer.verifyAccessToken(token, resource),
    requireBearerAuth: (opts: BearerAuthOptions = {}) => createBearerGuard(issuer, resource, { ...opts, resourceMetadataUrl: true }),
    protectedResourceMetadata,
    handleMetadataRequest,
    toAuthInfo,
  };
}
