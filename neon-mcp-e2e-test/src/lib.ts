import { createHash, randomBytes } from 'node:crypto';

export type StepResult = {
  n: number;
  name: string;
  pass: boolean;
  status: string;
  detail: string;
};

const results: StepResult[] = [];

export function record(n: number, name: string, pass: boolean, status: string, detail: string): StepResult {
  const r = { n, name, pass, status, detail };
  results.push(r);
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${n}. ${name} -> ${status}`);
  if (detail) console.log(`       ${detail}`);
  return r;
}

export function getResults(): StepResult[] {
  return results;
}

export function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(randomBytes(16));
}

/** Decodes a JWT's header/payload without verifying the signature (display only). */
export function decodeJwt(token: string): { header: unknown; payload: unknown } {
  const [headerB64, payloadB64] = token.split('.');
  const decode = (b64url: string) => {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  };
  return { header: decode(headerB64), payload: decode(payloadB64) };
}

/** Extracts the `name=value` pair (dropping attributes) for a cookie by name from Set-Cookie headers. */
export function extractCookie(setCookieHeaders: string[], cookieName: string): string | undefined {
  for (const line of setCookieHeaders) {
    const pair = line.split(';')[0]?.trim();
    if (pair?.startsWith(`${cookieName}=`)) return pair;
  }
  return undefined;
}

export function truncate(s: string, max = 300): string {
  return s.length > max ? `${s.slice(0, max)}...(${s.length} bytes)` : s;
}
