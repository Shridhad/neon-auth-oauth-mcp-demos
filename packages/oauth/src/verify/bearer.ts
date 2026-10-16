import { AuthServerUnavailableError, InvalidTokenError } from "./errors";
import type { AuthResult, Verifier } from "./verifier";

export interface BearerAuthOptions {
	requiredScopes?: string[];
}

/** Framework-neutral guard: the verified `AuthResult`, or a ready-to-send 401/403/503 `Response`. */
export type BearerGuard = (request: Request) => Promise<AuthResult | Response>;

/** RFC 9728 well-known URL for a resource: the well-known prefix with the resource's path inserted. */
export function protectedResourceMetadataUrl(resource: string): string {
	const u = new URL(resource);
	return new URL(
		`/.well-known/oauth-protected-resource${u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")}`,
		u.origin,
	).href;
}

export function createBearerGuard(
	verifier: Verifier,
	audience: string,
	opts: BearerAuthOptions & { resourceMetadataUrl?: string | true },
): BearerGuard {
	const required = opts.requiredScopes ?? [];
	const metadataUrl =
		opts.resourceMetadataUrl === true
			? protectedResourceMetadataUrl(audience)
			: opts.resourceMetadataUrl;

	// RFC 6750 challenge, in the same format as the MCP SDK's Express `requireBearerAuth`.
	// quoted-string values escape `\` and `"` with a backslash (RFC 9110 5.6.4).
	function challenge(
		status: 401 | 403,
		error: string,
		description: string,
		extra = "",
	): Response {
		const params =
			`Bearer error="${error}", error_description="${quoted(description)}"${extra}` +
			(metadataUrl ? `, resource_metadata="${quoted(metadataUrl)}"` : "");
		return Response.json(
			{ error, error_description: description },
			{ status, headers: { "WWW-Authenticate": params } },
		);
	}

	return async (request) => {
		try {
			const result = await verifier.verifyAccessToken(
				bearerToken(request),
				audience,
			);
			const missing = required.filter((s) => !result.scopes.includes(s));
			if (missing.length > 0) {
				return challenge(
					403,
					"insufficient_scope",
					`Missing required scope: ${missing.join(" ")}`,
					`, scope="${quoted(required.join(" "))}"`,
				);
			}
			return result;
		} catch (err) {
			if (err instanceof InvalidTokenError)
				return challenge(401, "invalid_token", err.message);
			if (err instanceof AuthServerUnavailableError) {
				return Response.json(
					{ error: "server_error", error_description: err.message },
					{ status: 503 },
				);
			}
			throw err;
		}
	};
}

const quoted = (value: string): string => value.replace(/["\\]/g, "\\$&");

function bearerToken(request: Request): string {
	const header = request.headers.get("authorization");
	if (!header)
		throw new InvalidTokenError(
			"missing_token",
			"Missing Authorization header",
		);
	const [type, token] = header.split(" ");
	if (type.toLowerCase() !== "bearer" || !token) {
		throw new InvalidTokenError(
			"malformed_header",
			"Invalid Authorization header format, expected 'Bearer TOKEN'",
		);
	}
	return token;
}
