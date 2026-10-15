// A real HTTP server standing in for Neon Auth, so tests exercise the same fetch + JWKS code paths production does.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';

export interface FakeAuthServer {
  issuer: string;
  hits: { discovery: number; jwks: number };
  /** Overrides the `issuer` field the discovery document reports. */
  setReportedIssuer(issuer: string): void;
  setDiscoveryDelay(ms: number): void;
  setDiscoveryStatus(status: number): void;
  sign(claims?: JWTPayload, opts?: { exp?: string | number; aud?: string | string[] | null; iss?: string }): Promise<string>;
  close(): Promise<void>;
}

export async function startFakeAuthServer(): Promise<FakeAuthServer> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'EdDSA', use: 'sig' };

  const hits = { discovery: 0, jwks: 0 };
  let reportedIssuer: string | undefined;
  let delayMs = 0;
  let status = 200;
  let issuer = '';

  const server = createServer((req, res) => {
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/auth/.well-known/oauth-authorization-server') {
      hits.discovery++;
      setTimeout(
        () => (status === 200 ? json(200, { issuer: reportedIssuer ?? issuer, jwks_uri: `${issuer}/jwks.json` }) : json(status, {})),
        delayMs,
      );
    } else if (req.url === '/auth/jwks.json') {
      hits.jwks++;
      json(200, { keys: [jwk] });
    } else {
      json(404, {});
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth`;

  return {
    issuer,
    hits,
    setReportedIssuer: (v) => (reportedIssuer = v),
    setDiscoveryDelay: (v) => (delayMs = v),
    setDiscoveryStatus: (v) => (status = v),
    async sign(claims = {}, opts = {}) {
      const jwt = new SignJWT({ client_id: 'client-1', scope: 'openid profile', ...claims })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
        .setIssuer(opts.iss ?? issuer)
        .setSubject('user-1')
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? '5m');
      if (opts.aud !== null) jwt.setAudience(opts.aud ?? 'http://api.test/mcp');
      return jwt.sign(privateKey);
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
