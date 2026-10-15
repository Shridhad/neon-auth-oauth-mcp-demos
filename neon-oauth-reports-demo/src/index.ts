import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

import { createOAuth } from '@neon/oauth-client';
import { authenticate, routeOAuthClient } from '@neon/oauth-client/adapter';
import { toNodeHandler } from '@neon/oauth-client/node';
import pg from 'pg';

import { generateDataset, renderDashboard, renderError, renderLanding } from './views.js';
import type { Dataset, Identity, LiveResult, LiveTodos } from './views.js';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return v;
};

const PORT = Number(process.env.PORT ?? '31101');
const ISSUER = required('NEON_AUTH_ISSUER');
// The API the access token is for; it becomes the token's `aud`.
const RESOURCE = process.env.REPORTS_RESOURCE ?? `http://localhost:${PORT}/api`;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const oauth = createOAuth({
  baseUrl: ISSUER,
  clientId: required('REPORTS_CLIENT_ID'),
  clientSecret: required('REPORTS_CLIENT_SECRET'),
  redirectUri: REDIRECT_URI,
  resource: RESOURCE,
  cookies: {
    // Without a configured secret, sessions end when the process restarts.
    secret: process.env.COOKIE_SECRET ?? randomBytes(32).toString('hex'),
    name: 'reports_session',
  },
});

const pool = process.env.TODOS_DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.TODOS_DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
  : undefined;
if (pool) pool.on('error', (e) => console.error('pg pool error:', e.message));

const DAY = 86_400_000;

async function loadLiveTodos(sub: string): Promise<LiveTodos> {
  if (!pool) throw new Error('TODOS_DATABASE_URL not set');
  const [agg, oldest, recent, perDay] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE done)::int AS done,
              count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last7
         FROM public.todos WHERE user_id = $1`,
      [sub],
    ),
    pool.query(
      `SELECT title, created_at FROM public.todos WHERE user_id = $1 AND NOT done ORDER BY created_at ASC, id ASC LIMIT 1`,
      [sub],
    ),
    pool.query(
      `SELECT title, created_at, done FROM public.todos WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 5`,
      [sub],
    ),
    pool.query(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS day, count(t.id)::int AS n
         FROM generate_series((now() AT TIME ZONE 'UTC')::date - 13, (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
         LEFT JOIN public.todos t ON t.user_id = $1 AND (t.created_at AT TIME ZONE 'UTC')::date = d::date
        GROUP BY d ORDER BY d`,
      [sub],
    ),
  ]);
  const { total, done, last7 } = agg.rows[0] as { total: number; done: number; last7: number };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    total,
    done,
    open: total - done,
    completionRate: total ? done / total : 0,
    createdLast7d: last7,
    oldestOpen: oldest.rows[0]
      ? { title: String(oldest.rows[0].title), ageMs: Date.now() - new Date(oldest.rows[0].created_at).getTime() }
      : null,
    mostRecent: recent.rows[0]
      ? { title: String(recent.rows[0].title), createdAt: new Date(recent.rows[0].created_at).getTime() }
      : null,
    perDay: perDay.rows.map((r: { day: string; n: number }) => ({
      label: `${MONTHS[Number(r.day.slice(5, 7)) - 1]} ${Number(r.day.slice(8, 10))}`,
      count: r.n,
    })),
    recent: recent.rows.map((r: { title: string; created_at: Date; done: boolean }) => ({
      title: String(r.title),
      createdAt: new Date(r.created_at).getTime(),
      done: Boolean(r.done),
    })),
  };
}

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

async function handleReports(request: Request): Promise<Response> {
  const outcome = await authenticate(oauth, request, { audience: RESOURCE });
  if (!outcome.ok) return outcome.response;
  const { auth } = outcome;
  const p = auth.claims;
  let live: { ok: true; data: LiveTodos } | { ok: false; error: string };
  try {
    live = { ok: true, data: await loadLiveTodos(auth.sub) };
  } catch (err) {
    console.error('live todos query failed:', err instanceof Error ? err.message : err);
    live = { ok: false, error: 'live to-do query failed' };
  }
  return Response.json({
    reports: [
      { id: 1, title: 'Q3 revenue', rows: 128 },
      { id: 2, title: 'Signups by region', rows: 54 },
      { id: 3, title: 'Churn cohort analysis', rows: 17 },
    ],
    sub: p.sub,
    client_id: p.client_id,
    aud: p.aud,
    iss: p.iss,
    name: p.name,
    email: p.email,
    scope: p.scope,
    exp: p.exp,
    dataset: generateDataset(auth.sub || 'anonymous'),
    live,
  });
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

async function handleHome(request: Request): Promise<Response> {
  const session = await oauth.client.getAccessToken(request);
  if (!session) return html(renderLanding());
  // A refresh rotates the session cookie; it has to ride along on whatever we send back.
  const respond = (res: Response) => {
    if (session.setCookie) res.headers.append('set-cookie', session.setCookie);
    return res;
  };
  let status = 0;
  let text = '';
  try {
    const r = await fetch(`http://localhost:${PORT}/api/reports`, { headers: { authorization: `Bearer ${session.accessToken}` } });
    status = r.status;
    text = await r.text();
  } catch (err) {
    return respond(html(renderError('Reports unavailable', 'Could not reach the reports API.', String(err)), 502));
  }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* handled below */
  }
  if (status !== 200 || !body.dataset) {
    const expired = status === 401;
    return respond(
      html(
        renderError(
          expired ? 'Your session has expired or is invalid' : 'Reports unavailable',
          expired ? 'The access token was missing, expired, or not valid for this resource. Please sign in again.' : `Unexpected response (HTTP ${status}).`,
          str(body.error_description) ?? (expired ? undefined : text.slice(0, 300)),
        ),
        expired ? 401 : 502,
      ),
    );
  }
  const user = await oauth.client.getUser(request);
  const aud = Array.isArray(body.aud) ? body.aud.map(String) : body.aud ? [String(body.aud)] : [];
  const id: Identity = {
    sub: String(body.sub ?? ''),
    name: user?.name || str(body.name),
    email: user?.email || str(body.email),
    picture: user?.image ?? undefined,
    nameSource: user ? 'userinfo' : undefined,
    clientId: str(body.client_id),
    aud,
    iss: str(body.iss),
    scope: str(body.scope),
    exp: typeof body.exp === 'number' ? body.exp : undefined,
  };
  return respond(html(renderDashboard(body.dataset as Dataset, id, RESOURCE, (body.live as LiveResult | undefined) ?? { ok: false })));
}

async function route(request: Request): Promise<Response> {
  const started = Date.now();
  const { pathname } = new URL(request.url);
  const response = await dispatch(request, pathname).catch((err: unknown) => {
    console.error('request failed:', err);
    return new Response(String(err), { status: 500 });
  });
  console.log(`${new Date().toISOString()} ${request.method} ${pathname} -> ${response.status} ${Date.now() - started}ms`);
  return response;
}

async function dispatch(request: Request, pathname: string): Promise<Response> {
  if (request.method === 'GET') {
    if (pathname === '/api/reports') return handleReports(request);
    if (pathname === '/') return handleHome(request);
    // Served at the root (not the default /auth) to keep the registered redirect URI `/callback`.
    const handled = await routeOAuthClient(oauth.client, request, { basePath: '' });
    if (handled) return handled;
  }
  return new Response('not found', { status: 404 });
}

const server = createServer(toNodeHandler(route));

server.listen(PORT, () => {
  console.log(`neon-oauth-reports-demo listening on http://localhost:${PORT}`);
  console.log(`  issuer=${ISSUER}\n  resource=${RESOURCE}\n  redirect_uri=${REDIRECT_URI}`);
});
