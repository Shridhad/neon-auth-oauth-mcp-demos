import { afterEach, describe, expect, it, vi } from 'vitest';

import { serializeCookie } from '../src/client/cookies.js';
import { createOAuth } from '../src/index.js';

const base = { baseUrl: 'https://auth.test/neondb/auth' };
const full = { ...base, clientId: 'c1', redirectUri: 'http://localhost:3000/auth/callback', cookies: { secret: 'x'.repeat(32) } };

afterEach(() => vi.unstubAllEnvs());

describe('createOAuth config', () => {
  it('requires baseUrl', () => {
    expect(() => createOAuth({} as never)).toThrow(/`baseUrl` is required/);
    expect(() => createOAuth(undefined as never)).toThrow(/`baseUrl` is required/);
  });

  it('requires baseUrl to be an absolute URL', () => {
    expect(() => createOAuth({ baseUrl: '/neondb/auth' })).toThrow(/absolute URL/);
  });

  it('never reads the environment', () => {
    vi.stubEnv('NEON_AUTH_BASE_URL', base.baseUrl);
    vi.stubEnv('AUTH_ISSUER', base.baseUrl);
    expect(() => createOAuth({} as never)).toThrow(/baseUrl/);
    vi.stubEnv('NEON_AUTH_CLIENT_ID', 'from-env');
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'y'.repeat(32));
    expect(() => createOAuth(base).client).toThrow(/missing: clientId, redirectUri, cookies\.secret/);
  });

  it('needs no client settings until .client is used', () => {
    expect(() => createOAuth(base)).not.toThrow();
  });

  it('names each missing client setting', () => {
    expect(() => createOAuth({ ...base, clientId: 'c1' }).client).toThrow(/missing: redirectUri, cookies\.secret/);
    expect(() => createOAuth({ ...base, clientId: 'c1', redirectUri: 'http://localhost/cb', cookies: {} }).client).toThrow(/cookies\.secret/);
  });

  it('rejects a short cookies.secret when the client is used', () => {
    expect(() => createOAuth({ ...full, cookies: { secret: 'short' } }).client).toThrow(/cookies\.secret must be at least 32/);
  });
});

describe('cookie options', () => {
  const set = async (cookies: object) => {
    const { client } = createOAuth({ ...full, cookies: { secret: 'x'.repeat(32), ...cookies } });
    const res = await client.handlers.logout(new Request('http://localhost:3000/auth/logout'));
    return res.headers.get('set-cookie')!;
  };

  it('applies name, domain and sameSite to the session cookie', async () => {
    const cookie = await set({ name: 'sid', domain: 'example.com', sameSite: 'strict' });
    expect(cookie).toBe('sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Domain=example.com');
  });

  it('forces Secure for SameSite=None', () => {
    expect(serializeCookie('a', 'b', { maxAge: 1, secure: false, sameSite: 'none' })).toContain('SameSite=None; Max-Age=1; Secure');
  });

  it('defaults to Lax and no Domain', async () => {
    expect(await set({})).toBe('neon_auth_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  });
});
