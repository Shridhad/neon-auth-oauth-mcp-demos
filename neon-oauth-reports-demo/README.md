# neon-oauth-reports-demo

Confidential OAuth client + protected resource in one tiny node:http app (port 31101).
Resource `GET /api/reports` accepts only JWTs issued by the Neon Auth tenant whose `aud` includes `REPORTS_RESOURCE`.
The client was created by an admin (no DCR) and uses `client_secret_basic`.

## Env (see `.env.example`)
- `NEON_AUTH_ISSUER` (required) e.g. `https://<endpointId>.neonauth.localtest.me:30443/neondb/auth`
- `REPORTS_CLIENT_ID`, `REPORTS_CLIENT_SECRET` (required) admin-created client credentials
- `REPORTS_RESOURCE` default `http://localhost:31101/api`
- `PORT` default `31101`

The client's registered redirect URI must be `http://localhost:31101/callback`.

## Run
```
npm install
cp .env.example .env   # fill in
npm run dev            # or npm start
```
Open http://localhost:31101/ and follow "Sign in". Every request is logged (method, path, status).
`NODE_TLS_REJECT_UNAUTHORIZED=0` is baked into the npm scripts for the self-signed local TLS.
