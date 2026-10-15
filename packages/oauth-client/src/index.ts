// Single entry point: one factory per Neon Auth issuer. Everything it returns (token verification,
// MCP resource servers, the OAuth client) shares one discovery cache and one key set.
import { createBearerGuard } from './bearer.js';
import type { BearerAuthOptions, BearerGuard } from './bearer.js';
import { createOAuthClient } from './client/index.js';
import type { CookieOptions, OAuthClient } from './client/index.js';
import { createIssuer } from './issuer.js';
import type { AuthResult, IssuerOptions } from './issuer.js';
import { createMcp } from './mcp/resource-server.js';
import type { McpOptions } from './mcp/resource-server.js';

export { AuthServerUnavailableError, InvalidTokenError } from './errors.js';
export type { InvalidTokenCode } from './errors.js';
export type { AuthResult, AuthServerMetadata } from './issuer.js';
export type { BearerAuthOptions, BearerGuard } from './bearer.js';
export type { McpOptions, McpResourceServer } from './mcp/resource-server.js';
export type { AuthUser, CookieOptions, LoginAttempt, OAuthClient, Session } from './client/index.js';

/** Configuration is explicit: nothing is read from the environment. */
export interface OAuthOptions {
  /** The Neon Auth URL, which is the OAuth issuer, e.g. `https://ep-x.neonauth.../neondb/auth`. Matched exactly against token `iss`. */
  baseUrl: string;
  /** Needed by `oauth.client` only. */
  clientId?: string;
  /** Omit for a public client (PKCE only). */
  clientSecret?: string;
  /** Must equal a redirect URI registered on the client, and be served by `client.handlers.callback`. */
  redirectUri?: string;
  /** The API the user's access token is for; becomes the token's `aud`. */
  resource?: string;
  scopes?: string[];
  /** Needed by `oauth.client` only. */
  cookies?: Partial<CookieOptions>;
  /** Accepted signature algorithms. Defaults to `['EdDSA']`; pinned so a token cannot pick its own. */
  algorithms?: string[];
  /** Seconds of clock skew tolerated on `exp`/`nbf`. */
  clockTolerance?: number;
  discovery?: {
    /** How long a discovery document is trusted before it is re-fetched. Default 1 hour. */
    ttlMs?: number;
    /** How long a failed discovery attempt is remembered, so an outage is not hammered. Default 5 seconds. */
    failureBackoffMs?: number;
  };
  /** Passed to jose's `createRemoteJWKSet`. */
  jwks?: IssuerOptions['jwks'];
}

export interface OAuthBearerOptions extends BearerAuthOptions {
  /** This API's identifier. Clients send it as `resource`, and Neon Auth stamps it into the token's `aud`. */
  audience: string;
  /**
   * Adds `resource_metadata` (RFC 9728) to `WWW-Authenticate` challenges. `true` derives the
   * path-inserted well-known URL from `audience`; a string is used verbatim. Off by default.
   */
  resourceMetadataUrl?: string | true;
}

export type OAuth = ReturnType<typeof createOAuth>;

export function createOAuth(options: OAuthOptions) {
  const baseUrl = options?.baseUrl;
  if (typeof baseUrl !== 'string' || baseUrl === '') {
    throw new Error('createOAuth: `baseUrl` is required (the Neon Auth URL, e.g. process.env.NEON_AUTH_BASE_URL).');
  }
  if (!URL.canParse(baseUrl)) {
    throw new Error(`createOAuth: \`baseUrl\` must be an absolute URL, got "${baseUrl}".`);
  }
  const issuer = createIssuer({
    issuer: baseUrl,
    algorithms: options.algorithms,
    clockTolerance: options.clockTolerance,
    discoveryTtlMs: options.discovery?.ttlMs,
    discoveryFailureBackoffMs: options.discovery?.failureBackoffMs,
    jwks: options.jwks,
  });

  let client: OAuthClient | undefined;

  return {
    /** `baseUrl` without a trailing slash. */
    issuer: issuer.issuer,
    getDiscovery: issuer.getDiscovery,

    /** Verifies signature, issuer, expiry and `audience`. Throws `InvalidTokenError` / `AuthServerUnavailableError`. */
    verifyAccessToken: (token: string, { audience }: { audience: string }): Promise<AuthResult> => issuer.verifyAccessToken(token, audience),

    /** Framework-neutral guard for a generic API: the verified result, or a ready 401/403/503 `Response`. */
    requireBearerAuth: ({ audience, ...rest }: OAuthBearerOptions): BearerGuard => createBearerGuard(issuer, audience, rest),

    /** An MCP server protected by this issuer. */
    mcp: (mcpOptions: McpOptions) => createMcp(issuer, mcpOptions),

    /** The OAuth client for signing users in. Throws on first access if its settings are incomplete. */
    get client(): OAuthClient {
      return (client ??= createOAuthClient(
        {
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          redirectUri: options.redirectUri,
          resource: options.resource,
          scopes: options.scopes,
          cookies: options.cookies as CookieOptions | undefined,
        },
        issuer.getDiscovery,
      ));
    },
  };
}
