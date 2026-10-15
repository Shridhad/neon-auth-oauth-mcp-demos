# neon-auth-mcp-demo

Minimal Next.js app that authenticates against a **local neon-auth server**
using the [`@neondatabase/neon-js`](https://github.com/neondatabase/neon-js)
SDK. It's meant to become the customer-hosted login + consent host for a
Neon Auth MCP/OAuth flow, so the auth wiring itself (middleware + proxy +
client provider) is the deliverable — not features.

## What's here

- `/login` — working sign-in (email + password) via `@neondatabase/auth-ui`'s
  `AuthView`. Also handles `/login/sign-up`, `/login/sign-out`, etc.
- `/` — authenticated landing page (Server Component) that reads the session
  via `auth.getSession()` and proves the cookie was established.
- `/consent` — unwired stub (heading + Allow/Deny buttons) so the URL
  resolves; real OAuth-consent wiring is a follow-up (see the `TODO` in
  `app/consent/page.tsx`).
- `proxy.ts` — Next.js's middleware-convention file; redirects unauthenticated
  requests to `/login` and refreshes the session cookie.
- `app/api/auth/[...path]/route.ts` — proxies all `/api/auth/*` calls to the
  upstream neon-auth server. This is also where neon-js's Safari cookie fix
  lives (strips `Partitioned`, rewrites `SameSite=None` to `Lax`) so the
  session cookie works as a first-party cookie in this app.

## Prerequisites

- A local neon-auth server running (self-signed TLS on `:30443`).
- The **root endpointId** and **database name** (usually `neondb`) of the
  Neon project neon-auth is running against.

## Configure

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:

- `NEON_AUTH_BASE_URL` — e.g.
  `https://<root-endpointId>.neonauth.localtest.me:30443/neondb/auth`
- `NEON_AUTH_COOKIE_SECRET` — random string, 32+ chars
  (`openssl rand -base64 32`)

## Run

```bash
npm install
npm run dev
```

Open http://localhost:31099/login and sign in (sign up first if you haven't
created a user yet — the sign-up link is on the sign-in page).

### Local TLS note

Local neon-auth's `:30443` endpoint uses a self-signed cert. The Next.js
server proxies to it server-side, so it needs
`NODE_TLS_REJECT_UNAUTHORIZED=0` to accept that cert. This is already wired
into `npm run dev` / `npm run start` in `package.json` — **dev-only**, don't
carry this into anything that talks to a real, non-self-signed neon-auth.

## MCP env vars

This app runs on port 31099 (see `dev`/`start` scripts — ports 3000/3100 are
reserved for other local services). Point the Neon Auth MCP at it over plain
HTTP (the app is `http`, not `https`, by default):

```
NEON_AUTH_MCP_LOGIN_PAGE=http://localhost:31099/login
NEON_AUTH_MCP_CONSENT_PAGE=http://localhost:31099/consent
```

If you've seen these drafted with an `https://localhost:3000` prefix
elsewhere, that's wrong for this app as configured — use the `http` form
above on port 31099, or run `next dev --experimental-https` if you
specifically need TLS.

## Scope

This is intentionally narrow: one sign-in path (email/password), no test
suite, no CI, no database/Data-API wiring. The full `/oauth2/authorize`
continuation (reading neon-auth's redirect params on `/login` and completing
the flow back through `/consent`) is a follow-up, not built here.
