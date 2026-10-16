/**
 * `@neon/oauth/verify` — verify Neon Auth access tokens in any resource server. Depends on
 * `jose` only: it never loads the sign-in client or `openid-client`.
 *
 * **Stability: beta.** Minor versions may include breaking changes.
 *
 * @module
 */

export type { BearerAuthOptions, BearerGuard } from "./bearer";
export { createBearerGuard, protectedResourceMetadataUrl } from "./bearer";
export type { InvalidTokenCode } from "./errors";
export { AuthServerUnavailableError, InvalidTokenError } from "./errors";
export type {
	AuthResult,
	AuthServerMetadata,
	Verifier,
	VerifierOptions,
} from "./verifier";
export { createVerifier } from "./verifier";
