import 'dotenv/config';

/**
 * neon-auth's OAuth-provider issuer for this project's root branch (same
 * value the OTHER demo app's NEON_AUTH_BASE_URL and neon-auth's own
 * NEON_AUTH_MCP_RESOURCE config point at). Used both to build the AS
 * discovery URL and, as configured (not re-derived from discovery), to
 * advertise `authorization_servers` in our protected-resource metadata.
 */
export const NEON_AUTH_ISSUER = required('NEON_AUTH_ISSUER');

/**
 * The exact resource identifier neon-auth's `NEON_AUTH_MCP_RESOURCE` mints
 * tokens for. Every access token this server accepts must carry this value
 * in its `aud` claim, and this server must advertise the same value as its
 * own `resource` in RFC 9728 protected-resource metadata. A mismatch between
 * this and neon-auth's `NEON_AUTH_MCP_RESOURCE` makes every call 403.
 */
export const MCP_RESOURCE = required('MCP_RESOURCE');

/**
 * Tenant Postgres holding `public.todos`. Its role has no access to the
 * `neon_auth` schema, so todos are scoped purely by the token's `sub`.
 */
export const TODOS_DATABASE_URL = required('TODOS_DATABASE_URL');

export const PORT = Number(process.env.PORT ?? '31100');

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}
