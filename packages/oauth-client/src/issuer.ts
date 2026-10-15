// Per-issuer plumbing shared by everything the factory hands out: one single-flight discovery
// cache and one JWKS resolver, so the verifier, MCP servers and the OAuth client never duplicate fetches.
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

import { AuthServerUnavailableError, InvalidTokenError } from './errors.js';

export interface IssuerOptions {
  /** Exact issuer URL of the Neon Auth branch, e.g. `https://<host>/neondb/auth`. */
  issuer: string;
  /** Accepted signature algorithms. Pinned so a token cannot pick its own (alg confusion). */
  algorithms?: string[];
  /** Seconds of clock skew tolerated on `exp`/`nbf`. */
  clockTolerance?: number;
  /** How long a discovery document is trusted before it is re-fetched. */
  discoveryTtlMs?: number;
  /** How long a failed discovery attempt is remembered, so an outage is not hammered. */
  discoveryFailureBackoffMs?: number;
  /** Passed to jose's `createRemoteJWKSet`. */
  jwks?: { cooldownDuration?: number; cacheMaxAge?: number; timeoutDuration?: number };
}

export interface AuthServerMetadata {
  issuer: string;
  jwks_uri: string;
  [key: string]: unknown;
}

export interface AuthResult {
  /** The raw bearer token, for forwarding or for the MCP SDK's `AuthInfo`. */
  token: string;
  sub: string;
  clientId: string;
  scopes: string[];
  audience: string[];
  /** Seconds since epoch. */
  expiresAt?: number;
  claims: JWTPayload;
}

// Neon Auth serves the first; the second is the OIDC fallback.
const DISCOVERY_PATHS = ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'];

export function createIssuer(options: IssuerOptions) {
  const issuer = options.issuer.replace(/\/$/, '');
  const algorithms = options.algorithms ?? ['EdDSA'];
  const ttlMs = options.discoveryTtlMs ?? 3_600_000;
  const failureBackoffMs = options.discoveryFailureBackoffMs ?? 5_000;

  async function fetchDiscovery(): Promise<AuthServerMetadata> {
    let notFound: Error | undefined;
    for (const path of DISCOVERY_PATHS) {
      const url = issuer + path;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.status === 404) {
        notFound = new Error(`Discovery document not found at ${url}`);
        continue;
      }
      if (!res.ok) throw new Error(`Authorization-server discovery failed: ${res.status} ${res.statusText} (${url})`);
      const doc = (await res.json()) as Partial<AuthServerMetadata>;
      // Without this check, whoever answers at the URL could point us at their own signing keys.
      if (doc.issuer !== issuer) {
        throw new Error(`Discovery issuer mismatch: expected "${issuer}", got "${String(doc.issuer)}" (${url})`);
      }
      if (!doc.jwks_uri) throw new Error(`Discovery document at ${url} is missing "jwks_uri"`);
      return doc as AuthServerMetadata;
    }
    throw notFound!;
  }

  let cached: { doc: AuthServerMetadata; expiresAt: number } | undefined;
  let inflight: Promise<AuthServerMetadata> | undefined;
  let failure: { error: unknown; until: number } | undefined;

  /** Cached discovery. Concurrent callers share one fetch; failures are remembered only briefly. */
  function getDiscovery(): Promise<AuthServerMetadata> {
    const now = Date.now();
    if (cached && cached.expiresAt > now) return Promise.resolve(cached.doc);
    if (failure && failure.until > now) return Promise.reject(failure.error);
    inflight ??= fetchDiscovery()
      .then((doc) => {
        cached = { doc, expiresAt: Date.now() + ttlMs };
        failure = undefined;
        return doc;
      })
      .catch((error: unknown) => {
        failure = { error, until: Date.now() + failureBackoffMs };
        throw error;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  }

  // Built once per jwks_uri so jose's key cache and cooldown actually work across requests.
  let keys: { uri: string; resolver: ReturnType<typeof createRemoteJWKSet> } | undefined;
  async function getKeys() {
    const { jwks_uri } = await getDiscovery();
    if (keys?.uri !== jwks_uri) keys = { uri: jwks_uri, resolver: createRemoteJWKSet(new URL(jwks_uri), options.jwks) };
    return keys.resolver;
  }

  async function verifyAccessToken(token: string, audience: string): Promise<AuthResult> {
    let resolver: Awaited<ReturnType<typeof getKeys>>;
    try {
      resolver = await getKeys();
    } catch (cause) {
      console.error('Authorization-server discovery failed:', cause);
      throw new AuthServerUnavailableError('Authorization server unavailable', { cause });
    }
    try {
      const { payload } = await jwtVerify(token, resolver, {
        // Exact match: branches of a project share signing keys, so the signature
        // alone does not prove the token came from the branch we trust.
        issuer,
        // A token minted for another API must not be replayable here.
        audience,
        algorithms,
        clockTolerance: options.clockTolerance,
      });
      return {
        token,
        sub: typeof payload.sub === 'string' ? payload.sub : '',
        clientId: typeof payload.client_id === 'string' ? payload.client_id : 'unknown',
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
        audience: payload.aud === undefined ? [] : [payload.aud].flat(),
        expiresAt: payload.exp,
        claims: payload,
      };
    } catch (err) {
      throw translateVerifyError(err);
    }
  }

  return { issuer, getDiscovery, verifyAccessToken };
}

export type Issuer = ReturnType<typeof createIssuer>;

function translateVerifyError(err: unknown): Error {
  if (err instanceof joseErrors.JWTExpired) return new InvalidTokenError('expired', err.message);
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    if (err.claim === 'aud') return new InvalidTokenError('invalid_audience', err.message);
    if (err.claim === 'iss') return new InvalidTokenError('invalid_issuer', err.message);
  }
  // Fetching keys timed out: the token may be fine, we just cannot tell.
  if (err instanceof joseErrors.JWKSTimeout) return new AuthServerUnavailableError('Authorization server unavailable', { cause: err });
  if (err instanceof joseErrors.JOSEError) return new InvalidTokenError('invalid_token', err.message);
  console.error('Token verification failed unexpectedly:', err);
  return new AuthServerUnavailableError('Token verification failed', { cause: err });
}
