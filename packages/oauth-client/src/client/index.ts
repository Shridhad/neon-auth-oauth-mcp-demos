// Client side of Neon Auth: sign users in (authorization code + PKCE) and keep the session in an encrypted cookie.
import { decodeJwt } from 'jose';
import * as oidc from 'openid-client';

import { COOKIE_SIZE_WARN_BYTES, deriveKey, parseCookies, seal, serializeCookie, unseal } from './cookies.js';
import type { SameSite } from './cookies.js';

import type { AuthServerMetadata } from '../issuer.js';

export interface OAuthClientOptions {
  clientId: string;
  /** Omit for a public client (PKCE only). */
  clientSecret?: string;
  /** Must equal a redirect URI registered on the client, and be served by `handlers.callback`. */
  redirectUri: string;
  /** The API the access token is for; becomes the token's `aud`. */
  resource?: string;
  scopes?: string[];
  cookies: CookieOptions;
}

export interface CookieOptions {
  /** At least 32 characters. Encrypts the cookies; changing it signs everyone out. */
  secret: string;
  /** Session cookie name. Defaults to `neon_auth_session`. */
  name?: string;
  /** Defaults to 7 days. */
  maxAgeSeconds?: number;
  /** Share the session across subdomains. Defaults to host-only. */
  domain?: string;
  /** Session cookie only; the login-transaction cookie is always Lax so the redirect back to the callback carries it. Defaults to `lax`. */
  sameSite?: SameSite;
}

/** Field names follow better-auth's `User`, which is what Neon Auth stores. */
export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image: string | null;
}

export interface Session {
  accessToken: string;
  refreshToken?: string;
  /** Access-token expiry, seconds since epoch. */
  expiresAt?: number;
  user: AuthUser;
}

export interface LoginAttempt {
  state: string;
  codeVerifier: string;
}

export type OAuthClient = ReturnType<typeof createOAuthClient>;

const TX_MAX_AGE_SECONDS = 600;
const REFRESH_SKEW_SECONDS = 30;

/**
 * `getDiscovery` is the issuer's shared cache, so the client never fetches discovery on its own.
 * Missing required settings throw an error naming each one.
 */
export function createOAuthClient(
  options: Partial<OAuthClientOptions>,
  getDiscovery: () => Promise<AuthServerMetadata>,
) {
  const missing = [
    !options.clientId && 'clientId',
    !options.redirectUri && 'redirectUri',
    !options.cookies?.secret && 'cookies.secret',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`oauth.client is not configured (missing: ${missing.join(', ')}). Pass them to createOAuth().`);
  }
  const { clientId, clientSecret, redirectUri, resource } = options as OAuthClientOptions;
  const cookieSecret = options.cookies!.secret;
  const scopes = options.scopes ?? ['openid', 'profile', 'email'];
  const sessionCookie = options.cookies!.name ?? 'neon_auth_session';
  const txCookie = `${sessionCookie}_tx`;
  const sessionMaxAge = options.cookies!.maxAgeSeconds ?? 7 * 86_400;
  const { domain, sameSite } = options.cookies!;

  // Fail at startup, not on the first login.
  deriveKey(cookieSecret, 'session');

  const redirect = new URL(redirectUri);
  const localHttp = redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
  const secure = !localHttp;

  // Built from the shared discovery document, and rebuilt when that cache refreshes. Lazy so the app
  // boots before Neon Auth is reachable.
  let configured: { doc: AuthServerMetadata; config: oidc.Configuration } | undefined;
  async function getConfiguration(): Promise<oidc.Configuration> {
    const doc = await getDiscovery();
    if (configured?.doc !== doc) {
      configured = {
        doc,
        config: new oidc.Configuration(
          doc as oidc.ServerMetadata,
          clientId,
          undefined,
          // Neon Auth rejects client_secret_post for confidential clients, so authenticate
          // at the token endpoint with HTTP Basic. Public clients send no secret and rely on PKCE.
          clientSecret ? oidc.ClientSecretBasic(clientSecret) : oidc.None(),
        ),
      };
    }
    return configured.config;
  }

  /** Step 1: the authorize URL to redirect the browser to, plus the values to keep until the callback. */
  async function startLogin(): Promise<LoginAttempt & { url: URL }> {
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const url = oidc.buildAuthorizationUrl(await getConfiguration(), {
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      ...(resource && { resource }),
      state,
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
    });
    return { url, state, codeVerifier };
  }

  /** Step 2: exchange the callback's `code` for tokens (checking `state`, sending the PKCE verifier) and load the user. */
  async function finishLogin(callbackUrl: URL, attempt: LoginAttempt): Promise<Session> {
    const config = await getConfiguration();
    const tokens = await oidc.authorizationCodeGrant(
      config,
      callbackUrl,
      // The access token is the product here; don't require an ID token.
      { pkceCodeVerifier: attempt.codeVerifier, expectedState: attempt.state, idTokenExpected: false },
      // Repeated on the token request so the issued token is bound to this API.
      resource ? { resource } : undefined,
    );
    return {
      ...sessionFromTokens(tokens),
      user: await loadUser(config, tokens),
    };
  }

  function sessionFromTokens(tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers) {
    const expiresIn = tokens.expiresIn();
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: expiresIn !== undefined ? Math.floor(Date.now() / 1000) + expiresIn : decodeJwt(tokens.access_token).exp,
    };
  }

  // Neon Auth's ID token has no name/email, so the profile comes from the userinfo endpoint.
  async function loadUser(
    config: oidc.Configuration,
    tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers,
  ): Promise<AuthUser> {
    const idClaims: Record<string, unknown> = { ...tokens.claims() };
    let info: Record<string, unknown> = {};
    try {
      info = await oidc.fetchUserInfo(config, tokens.access_token, (idClaims.sub as string | undefined) ?? oidc.skipSubjectCheck);
    } catch (err) {
      console.error('userinfo failed:', err instanceof Error ? err.message : err);
    }
    const claims = { ...idClaims, ...info };
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const email = str(claims.email) ?? '';
    return {
      id: str(claims.sub) ?? str(decodeJwt(tokens.access_token).sub) ?? '',
      email,
      emailVerified: claims.email_verified === true,
      name: str(claims.name) ?? email,
      image: str(claims.picture) ?? null,
    };
  }

  async function sessionSetCookie(session: Session): Promise<string> {
    const value = await seal(session, cookieSecret, 'session', sessionMaxAge);
    if (value.length > COOKIE_SIZE_WARN_BYTES) {
      console.warn(
        `[oauth-client] session cookie is ${value.length} bytes; browsers drop cookies over ~4096. ` +
          'Shrink the tokens or move the session server-side.',
      );
    }
    return serializeCookie(sessionCookie, value, { maxAge: sessionMaxAge, secure, domain, sameSite });
  }

  // Attributes must match the ones the cookie was set with, or the browser keeps it.
  const clearSession = () => serializeCookie(sessionCookie, '', { maxAge: 0, secure, domain, sameSite });
  const clearTx = () => serializeCookie(txCookie, '', { maxAge: 0, secure });

  async function getSession(request: Request): Promise<Session | undefined> {
    return unseal<Session>(parseCookies(request.headers.get('cookie'))[sessionCookie], cookieSecret, 'session');
  }

  async function getUser(request: Request): Promise<AuthUser | undefined> {
    return (await getSession(request))?.user;
  }

  /**
   * A usable access token for this request, refreshed first if it is about to expire.
   * When a refresh happened, `setCookie` holds the updated session cookie: append it to
   * your response as a `Set-Cookie` header or the next request will refresh again.
   * Returns undefined when the user must sign in again.
   * Refresh tokens may rotate, so avoid refreshing from many parallel requests.
   */
  async function getAccessToken(request: Request): Promise<{ accessToken: string; setCookie?: string } | undefined> {
    const session = await getSession(request);
    if (!session) return undefined;
    const now = Math.floor(Date.now() / 1000);
    if (session.expiresAt === undefined || session.expiresAt - REFRESH_SKEW_SECONDS > now) {
      return { accessToken: session.accessToken };
    }
    if (!session.refreshToken) return undefined;
    try {
      const tokens = await oidc.refreshTokenGrant(await getConfiguration(), session.refreshToken, resource ? { resource } : undefined);
      const refreshed: Session = {
        ...session,
        ...sessionFromTokens(tokens),
        // Not every server rotates the refresh token.
        refreshToken: tokens.refresh_token ?? session.refreshToken,
      };
      return { accessToken: refreshed.accessToken, setCookie: await sessionSetCookie(refreshed) };
    } catch (err) {
      console.error('token refresh failed:', err instanceof Error ? err.message : err);
      return undefined;
    }
  }

  // Only same-site paths, so /login?returnTo=https://evil.example cannot become an open redirect.
  const safeReturnTo = (v: unknown): string => (typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : '/');

  const text = (status: number, body: string) =>
    new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

  const handlers = {
    /** Starts sign-in. Honors `?returnTo=/path`. */
    async login(request: Request): Promise<Response> {
      const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
      const { url, state, codeVerifier } = await startLogin();
      const tx = await seal({ state, codeVerifier, returnTo }, cookieSecret, 'tx', TX_MAX_AGE_SECONDS);
      return new Response(null, {
        status: 302,
        headers: {
          location: url.toString(),
          'set-cookie': serializeCookie(txCookie, tx, { maxAge: TX_MAX_AGE_SECONDS, secure }),
          'cache-control': 'no-store',
        },
      });
    },

    /** Finishes sign-in at `redirectUri`: validates state, exchanges the code, sets the session cookie, redirects to returnTo. */
    async callback(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const error = url.searchParams.get('error');
      if (error) return text(400, `${error}: ${url.searchParams.get('error_description') ?? ''}`);

      const tx = await unseal<LoginAttempt & { returnTo: string }>(parseCookies(request.headers.get('cookie'))[txCookie], cookieSecret, 'tx');
      if (!tx) return text(400, 'Sign-in attempt not found or expired. Start again.');

      let session: Session;
      try {
        // Rebuilt on the configured redirect URI: behind a proxy the request's own origin is not the public one.
        session = await finishLogin(new URL(url.pathname + url.search, redirectUri), tx);
      } catch (err) {
        console.error('sign-in failed:', err);
        return text(err instanceof oidc.ClientError ? 400 : 502, `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const headers = new Headers({ location: safeReturnTo(tx.returnTo), 'cache-control': 'no-store' });
      headers.append('set-cookie', await sessionSetCookie(session));
      headers.append('set-cookie', clearTx());
      return new Response(null, { status: 302, headers });
    },

    /** Clears the local session only; it does not end the Neon Auth session. */
    async logout(request: Request): Promise<Response> {
      const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
      return new Response(null, { status: 302, headers: { location: returnTo, 'set-cookie': clearSession() } });
    },
  };

  return { getConfiguration, startLogin, finishLogin, handlers, getSession, getUser, getAccessToken };
}
