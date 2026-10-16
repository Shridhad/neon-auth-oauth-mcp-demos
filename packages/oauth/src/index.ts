/**
 * `@neon/oauth` — sign users in to your app with Neon Auth as the OAuth provider, and verify
 * the bearer tokens it issues.
 *
 * **Stability: beta.** Minor versions may include breaking changes.
 *
 * @module
 */

import type { CookieOptions, OAuthClient } from "./client";
import { createOAuthClient } from "./client";
import type { McpOptions, McpResourceServer } from "./mcp/resource-server";
import { createMcp } from "./mcp/resource-server";
import type { BearerAuthOptions, BearerGuard } from "./verify/bearer";
import { createBearerGuard } from "./verify/bearer";
import type {
	AuthResult,
	AuthServerMetadata,
	VerifierOptions,
} from "./verify/verifier";
import { createVerifier } from "./verify/verifier";

export type {
	AccessTokenContext,
	AccessTokenFailure,
	AccessTokenResult,
	AuthUser,
	CookieOptions,
	LoginAttempt,
	OAuthClient,
	Session,
} from "./client";
export type {
	McpOptions,
	McpResourceServer,
} from "./mcp/resource-server";
export type { BearerAuthOptions, BearerGuard } from "./verify/bearer";
export type { InvalidTokenCode } from "./verify/errors";
export {
	AuthServerUnavailableError,
	InvalidTokenError,
} from "./verify/errors";
export type {
	AuthResult,
	AuthServerMetadata,
} from "./verify/verifier";

interface OAuthCommonOptions extends VerifierOptions {
	/**
	 * The API this app's access tokens are for; becomes the token's `aud`. The client requests it
	 * at sign-in, and `requireBearerAuth()` verifies against it unless given an explicit `audience`.
	 */
	resource?: string;
}

/** The sign-in client's settings. All of `clientId`, `redirectUri` and `cookies` are required together. */
export interface OAuthClientConfig {
	clientId: string;
	/** Omit for a public client (PKCE only). */
	clientSecret?: string;
	/** Must equal a redirect URI registered on the client. Its path must end in `/callback`; adapters serve the sign-in routes from the path's prefix. */
	redirectUri: string;
	scopes?: string[];
	cookies: CookieOptions;
}

/** Verification and MCP only. Client settings are rejected at compile time so `client` is never half-configured. */
export type OAuthWithoutClientOptions = OAuthCommonOptions & {
	[K in keyof OAuthClientConfig]?: never;
};

/** Everything in `OAuthWithoutClientOptions`, plus a sign-in client exposed as `oauth.client`. */
export type OAuthWithClientOptions = OAuthCommonOptions & OAuthClientConfig;

export type OAuthOptions = OAuthWithoutClientOptions | OAuthWithClientOptions;

export interface OAuthBearerOptions extends BearerAuthOptions {
	/**
	 * This API's identifier. Clients send it as `resource`, and Neon Auth stamps it into the token's `aud`.
	 * Defaults to the `resource` passed to `createOAuth`; one of the two is required.
	 */
	audience?: string;
	/**
	 * Adds `resource_metadata` (RFC 9728) to `WWW-Authenticate` challenges. `true` derives the
	 * path-inserted well-known URL from the audience; a string is used verbatim. Off by default.
	 */
	resourceMetadataUrl?: string | true;
}

export interface OAuth {
	/** `baseUrl` without a trailing slash. */
	readonly issuer: string;
	getDiscovery(): Promise<AuthServerMetadata>;
	/** Verifies signature, issuer, expiry and `audience`. Throws `InvalidTokenError` / `AuthServerUnavailableError`. */
	verifyAccessToken(
		token: string,
		options: { audience: string },
	): Promise<AuthResult>;
	/**
	 * Framework-neutral guard for a generic API: the verified result, or a ready 401/403/503 `Response`.
	 * Throws when neither `options.audience` nor the configured `resource` is set.
	 */
	requireBearerAuth(options?: OAuthBearerOptions): BearerGuard;
	/** An MCP server protected by this issuer, sharing this instance's discovery cache. Prefer `createMcpAuth` from `@neon/oauth/mcp` when nothing else is needed. */
	mcp(options: McpOptions): McpResourceServer;
}

export interface OAuthWithClient extends OAuth {
	/** The OAuth client for signing users in. */
	readonly client: OAuthClient;
}

/**
 * One issuer, one discovery cache. `oauth.client` exists only when `clientId`, `redirectUri`
 * and `cookies` are provided; a partial client configuration throws here, naming what is missing.
 */
export function createOAuth(options: OAuthWithClientOptions): OAuthWithClient;
export function createOAuth(options: OAuthWithoutClientOptions): OAuth;
export function createOAuth(options: OAuthOptions): OAuth | OAuthWithClient {
	const verifier = createVerifier(options);
	const { resource } = options;

	const oauth: OAuth = {
		issuer: verifier.issuer,
		getDiscovery: verifier.getDiscovery,
		verifyAccessToken: (token, { audience }) =>
			verifier.verifyAccessToken(token, audience),
		requireBearerAuth: ({ audience, ...rest } = {}) => {
			const aud = audience ?? resource;
			if (!aud) {
				throw new Error(
					"requireBearerAuth needs an `audience`, or a `resource` passed to createOAuth().",
				);
			}
			return createBearerGuard(verifier, aud, rest);
		},
		mcp: (mcpOptions) => createMcp(verifier, mcpOptions),
	};

	const hasClientSettings = CLIENT_KEYS.some(
		(key) => key in options && options[key] !== undefined,
	);
	if (!hasClientSettings) return oauth;
	return {
		...oauth,
		client: createOAuthClient(
			{
				clientId: options.clientId,
				clientSecret: options.clientSecret,
				redirectUri: options.redirectUri,
				resource,
				scopes: options.scopes,
				cookies: options.cookies,
			},
			verifier.getDiscovery,
		),
	};
}

const CLIENT_KEYS = [
	"clientId",
	"clientSecret",
	"redirectUri",
	"scopes",
	"cookies",
] as const;
