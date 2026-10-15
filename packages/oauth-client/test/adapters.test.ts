// Contract tests for adapters/core.ts, then one thin smoke test per adapter proving it maps
// 401 / 200 / metadata / client routes through the contract.
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authenticate, routeMcpMetadata, routeOAuthClient } from '../src/adapters/core.js';
import { expressBearerAuth, expressMcp, expressOAuthClient } from '../src/adapters/express.js';
import type { AuthedRequest } from '../src/adapters/express.js';
import { honoBearerAuth, honoMcp, honoOAuthClient } from '../src/adapters/hono.js';
import { createMetadataHandlers, createRouteHandlers, withAuth } from '../src/adapters/next.js';
import { nodeBearerAuth, nodeMcp, toNodeHandler } from '../src/adapters/node.js';
import { createOAuth } from '../src/index.js';
import { startFakeAuthServer } from './fake-auth-server.js';
import type { FakeAuthServer } from './fake-auth-server.js';

const RESOURCE = 'http://api.test/mcp';
const META = '/.well-known/oauth-protected-resource/mcp';
const API = 'http://api.test/api';

let fake: FakeAuthServer;
let servers: Server[] = [];
beforeEach(async () => {
  fake = await startFakeAuthServer();
});
afterEach(async () => {
  await fake.close();
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
});

const oauth = () =>
  createOAuth({ baseUrl: fake.issuer, clientId: 'c1', redirectUri: 'http://api.test/auth/callback', cookies: { secret: 'x'.repeat(32) } });
const mcp = () => oauth().mcp({ resource: RESOURCE });
const bearer = async (aud?: string) => ({ authorization: `Bearer ${await fake.sign({}, aud ? { aud } : {})}` });
const apiBearer = () => bearer(API);

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('core contract', () => {
  it('authenticate returns { ok: true, auth } for a valid token', async () => {
    const out = await authenticate(mcp(), new Request(RESOURCE, { headers: await bearer() }));
    expect(out).toMatchObject({ ok: true, auth: { sub: 'user-1' } });
  });

  it('authenticate returns { ok: false, response } with the challenge', async () => {
    const out = await authenticate(mcp(), new Request(RESOURCE));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.response.status).toBe(401);
    expect(out.response.headers.get('www-authenticate')).toContain(`resource_metadata="http://api.test${META}"`);
  });

  it('authenticate takes an audience for the generic source and enforces scopes', async () => {
    const o = oauth();
    const headers = await apiBearer();
    expect(await authenticate(o, new Request(API, { headers }), { audience: API })).toMatchObject({ ok: true });
    const denied = await authenticate(o, new Request(API, { headers }), { audience: API, requiredScopes: ['admin'] });
    expect(!denied.ok && denied.response.status).toBe(403);
  });

  it('routeMcpMetadata answers metadata and ignores everything else', async () => {
    const m = mcp();
    expect(routeMcpMetadata(m, new Request(`http://api.test${META}`))!.status).toBe(200);
    expect(routeMcpMetadata(m, new Request(`http://api.test${META}`, { method: 'OPTIONS' }))!.status).toBe(204);
    expect(routeMcpMetadata(m, new Request(RESOURCE))).toBeUndefined();
  });

  it('routeOAuthClient routes GET under basePath (default /auth) and ignores the rest', async () => {
    const { client } = oauth();
    const logout = await routeOAuthClient(client, new Request('http://api.test/auth/logout?returnTo=/x'));
    expect(logout!.status).toBe(302);
    expect(logout!.headers.get('location')).toBe('/x');
    expect(await routeOAuthClient(client, new Request('http://api.test/logout'))).toBeUndefined();
    expect(await routeOAuthClient(client, new Request('http://api.test/auth/other'))).toBeUndefined();
    expect(await routeOAuthClient(client, new Request('http://api.test/auth/logout', { method: 'POST' }))).toBeUndefined();
  });

  it('routeOAuthClient honours a custom or empty basePath', async () => {
    const { client } = oauth();
    expect((await routeOAuthClient(client, new Request('http://api.test/logout'), { basePath: '' }))!.status).toBe(302);
    expect((await routeOAuthClient(client, new Request('http://api.test/api/auth/logout'), { basePath: '/api/auth/' }))!.status).toBe(302);
  });

});

describe('hono adapter', () => {
  it('maps 401 / 200 / metadata / client routes', async () => {
    const o = oauth();
    const app = new Hono();
    app.use(honoOAuthClient(o.client));
    honoMcp(app, o.mcp({ resource: RESOURCE }));
    app.post('/mcp', (c) => c.json({ ok: true }));
    app.get('/api', honoBearerAuth(o, { audience: API }), (c) => c.text('ok'));
    expect((await app.request('/mcp', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/mcp', { method: 'POST', headers: await bearer() })).status).toBe(200);
    expect((await app.request(META)).status).toBe(200);
    expect((await app.request('/auth/logout')).status).toBe(302);
    expect((await app.request('/api')).status).toBe(401);
    expect((await app.request('/api', { headers: await apiBearer() })).status).toBe(200);
  });
});

describe('node adapter', () => {
  it('toNodeHandler serves a fetch handler, keeping repeated Set-Cookie separate', async () => {
    const url = await listen(
      toNodeHandler(() => {
        const h = new Headers();
        h.append('set-cookie', 'a=1');
        h.append('set-cookie', 'b=2');
        return new Response('hi', { headers: h });
      }),
    );
    const res = await fetch(url);
    expect(await res.text()).toBe('hi');
    expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
  });

  it('nodeMcp / nodeBearerAuth map 401 / 200 / metadata and fall through otherwise', async () => {
    const m = mcp();
    const mw = nodeMcp(m);
    const api = nodeBearerAuth(oauth(), { audience: API });
    const url = await listen((req, res) =>
      mw(req, res, () => {
        if (req.url === '/api') return api(req, res, () => res.end('api ok'));
        res.end('fell through');
      }),
    );
    expect((await fetch(`${url}/mcp`, { method: 'POST' })).status).toBe(401);
    const ok = await fetch(`${url}/mcp`, { method: 'POST', headers: await bearer() });
    expect(await ok.text()).toBe('fell through');
    const meta = await fetch(url + META);
    expect(await meta.json()).toMatchObject({ resource: RESOURCE });
    expect(await (await fetch(`${url}/other`)).text()).toBe('fell through');
    expect((await fetch(`${url}/api`)).status).toBe(401);
  });
});

describe('express adapter', () => {
  it('maps 401 / 200 (req.auth) / metadata / client routes', async () => {
    const o = oauth();
    const app = express();
    app.use(expressOAuthClient(o.client));
    app.use(expressMcp(o.mcp({ resource: RESOURCE })));
    app.use(express.json());
    app.post('/mcp', (req, res) => void res.json({ sub: (req as AuthedRequest).auth.sub }));
    app.get('/api', expressBearerAuth(o, { audience: API }), (req, res) => void res.json({ sub: (req as AuthedRequest).auth.sub }));
    const url = await listen(app);

    const denied = await fetch(`${url}/mcp`, { method: 'POST' });
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect(await (await fetch(`${url}/mcp`, { method: 'POST', headers: await bearer() })).json()).toEqual({ sub: 'user-1' });
    expect(await (await fetch(url + META)).json()).toMatchObject({ resource: RESOURCE });
    expect((await fetch(`${url}/auth/logout`, { redirect: 'manual' })).status).toBe(302);
    expect((await fetch(`${url}/api`)).status).toBe(401);
    expect(await (await fetch(`${url}/api`, { headers: await apiBearer() })).json()).toEqual({ sub: 'user-1' });
  });
});

describe('next adapter', () => {
  it('withAuth maps 401 / 200 and passes route context', async () => {
    const o = oauth();
    const GET = withAuth(o, (_req, auth, ctx: { id: string }) => Response.json({ sub: auth.sub, id: ctx.id }), { audience: API });
    expect((await GET(new Request(API), { id: '1' })).status).toBe(401);
    const ok = await GET(new Request(API, { headers: await apiBearer() }), { id: '1' });
    expect(await ok.json()).toEqual({ sub: 'user-1', id: '1' });
  });

  it('createRouteHandlers serves the client routes under /api/auth and 404s otherwise', async () => {
    const { GET } = createRouteHandlers(oauth().client);
    expect((await GET(new Request('http://api.test/api/auth/logout'))).status).toBe(302);
    expect((await GET(new Request('http://api.test/api/auth/nope'))).status).toBe(404);
  });

  it('createMetadataHandlers serves GET and OPTIONS', async () => {
    const { GET, OPTIONS } = createMetadataHandlers(mcp());
    expect((await GET(new Request(`http://api.test${META}`))).status).toBe(200);
    expect(OPTIONS(new Request(`http://api.test${META}`, { method: 'OPTIONS' })).status).toBe(204);
  });
});
