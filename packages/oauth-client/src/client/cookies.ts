// Stateless cookies: the server keeps no session store, the browser carries the (encrypted) state.
import { hkdfSync } from 'node:crypto';

import { EncryptJWT, jwtDecrypt } from 'jose';

const MIN_SECRET_LENGTH = 32;
// Browsers drop cookies over ~4096 bytes; leave room for the name and attributes.
export const COOKIE_SIZE_WARN_BYTES = 3800;

/** One key per purpose, so a login-transaction cookie can never be replayed as a session cookie. */
export function deriveKey(secret: string, purpose: string): Uint8Array {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`cookies.secret must be at least ${MIN_SECRET_LENGTH} characters (try: openssl rand -hex 32)`);
  }
  return new Uint8Array(hkdfSync('sha256', secret, 'neon-auth-oauth/cookies', purpose, 32));
}

/** Encrypts (not just signs) the payload: it contains the user's access and refresh tokens. */
export async function seal(payload: object, secret: string, purpose: string, maxAgeSeconds: number): Promise<string> {
  return new EncryptJWT({ data: payload })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .encrypt(deriveKey(secret, purpose));
}

/** Returns undefined for anything that is not a valid, unexpired cookie sealed with this secret and purpose. */
export async function unseal<T>(value: string | undefined, secret: string, purpose: string): Promise<T | undefined> {
  if (!value) return undefined;
  try {
    const { payload } = await jwtDecrypt(value, deriveKey(secret, purpose), {
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    return payload.data as T;
  } catch {
    return undefined;
  }
}

export type SameSite = 'lax' | 'strict' | 'none';

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean; domain?: string; sameSite?: SameSite },
): string {
  const sameSite = opts.sameSite ?? 'lax';
  // Browsers reject SameSite=None without Secure.
  const secure = opts.secure || sameSite === 'none';
  return (
    `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}; Max-Age=${opts.maxAge}` +
    `${opts.domain ? `; Domain=${opts.domain}` : ''}${secure ? '; Secure' : ''}`
  );
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
