// Automated, re-runnable end-to-end test of the MCP OAuth flow against the
// local Neon Auth authorization server + MCP resource server. Plays the role
// of an MCP client (Cursor) driving the full RFC 9728 discovery -> DCR ->
// authorize -> consent -> token -> MCP-call sequence over plain HTTP, so the
// flow can be verified without hand-testing in Cursor.
//
// Run: npm run test:e2e  (from this directory)

import { decodeJwt, extractCookie, newPkcePair, randomState, record, truncate, getResults } from './lib.js';
import { mcpPost } from './mcp.js';

const MCP_RESOURCE_URL = process.env.MCP_RESOURCE_URL ?? 'http://localhost:31100/mcp';
const LOOPBACK_REDIRECT_URI = 'http://127.0.0.1:33418/callback';
const REQUESTED_SCOPE = 'openid profile email';
// Fixed credentials (not a fresh email per run) so re-runs sign in rather
// than re-registering -- see step 5.
const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? 'e2e-oauth-test@example.com';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'E2E-Test-Passw0rd!1';

async function step1_discoverProtectedResource(): Promise<string> {
  const res = await fetch(MCP_RESOURCE_URL);
  const wwwAuth = res.headers.get('www-authenticate') ?? '';
  const match = /resource_metadata="([^"]+)"/.exec(wwwAuth);
  const pass = res.status === 401 && !!match;
  record(
    1,
    'GET /mcp without a token',
    pass,
    `${res.status} ${res.statusText}`,
    `WWW-Authenticate: ${truncate(wwwAuth)}`,
  );
  if (!match) throw new Error('step 1: no resource_metadata URL in WWW-Authenticate challenge');
  return match[1];
}

async function step2_fetchProtectedResourceMetadata(resourceMetadataUrl: string): Promise<string> {
  const res = await fetch(resourceMetadataUrl);
  const body = (await res.json()) as { authorization_servers?: string[] };
  const asOrigin = body.authorization_servers?.[0];
  const pass = res.ok && !!asOrigin;
  record(2, 'GET protected-resource metadata', pass, `${res.status} ${res.statusText}`, JSON.stringify(body));
  if (!asOrigin) throw new Error('step 2: no authorization_servers[0] in protected-resource metadata');
  return asOrigin;
}

type AsMetadata = { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string };

async function step3_fetchAsMetadata(asOrigin: string): Promise<AsMetadata> {
  const res = await fetch(`${asOrigin}/.well-known/oauth-authorization-server`);
  const body = (await res.json()) as Partial<AsMetadata>;
  const pass = res.ok && !!body.authorization_endpoint && !!body.token_endpoint && !!body.registration_endpoint;
  record(
    3,
    'GET AS metadata (.well-known/oauth-authorization-server)',
    pass,
    `${res.status} ${res.statusText}`,
    `authorization_endpoint=${body.authorization_endpoint} token_endpoint=${body.token_endpoint} registration_endpoint=${body.registration_endpoint}`,
  );
  if (!pass) throw new Error('step 3: AS metadata missing required endpoints');
  return body as AsMetadata;
}

async function step4_registerClient(registrationEndpoint: string, asOrigin: string): Promise<string> {
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: asOrigin },
    body: JSON.stringify({
      client_name: 'neon-mcp-e2e-test',
      redirect_uris: [LOOPBACK_REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      // oauth-provider defaults an unspecified application_type to "web" for
      // dynamic client registration, and "web" clients are required to use
      // https on a non-loopback host -- our loopback redirect_uri needs the
      // "native" type to pass validateClientRedirectUri.
      application_type: 'native',
      scope: REQUESTED_SCOPE,
    }),
  });
  const body = (await res.json()) as { client_id?: string; error?: string; error_description?: string };
  const pass = res.status === 201 && !!body.client_id;
  record(4, 'DCR: POST registration_endpoint (anonymous)', pass, `${res.status} ${res.statusText}`, JSON.stringify(body));
  if (!body.client_id) throw new Error(`step 4: registration failed: ${JSON.stringify(body)}`);
  return body.client_id;
}

async function step5_establishSession(asOrigin: string): Promise<string> {
  const signIn = () =>
    fetch(`${asOrigin}/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: asOrigin },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });

  let res = await signIn();
  let via = 'sign-in/email';
  if (!res.ok) {
    via = 'sign-up/email (no existing test user)';
    res = await fetch(`${asOrigin}/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: asOrigin },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: 'E2E OAuth Test User' }),
    });
  }

  const setCookie = res.headers.getSetCookie();
  const sessionCookie = extractCookie(setCookie, '__Secure-neon-auth.session_token');
  const pass = res.ok && !!sessionCookie;
  const bodyText = await res.text();
  record(
    5,
    `Sign in as test user via ${via}`,
    pass,
    `${res.status} ${res.statusText}`,
    sessionCookie ? `session cookie captured` : `no session cookie; body=${truncate(bodyText)}`,
  );
  if (!sessionCookie) {
    throw new Error(
      'step 5: no session cookie after sign-in/sign-up. If this project only supports email-OTP/magic-link ' +
        'sign-in, the code cannot be retrieved locally without a mail sink -- that is a genuine blocker, not a bug in this script.',
    );
  }
  return sessionCookie;
}

type AuthorizeOutcome = { code?: string; consentRedirectQuery?: string; location: string };

async function step6_authorize(
  authorizationEndpoint: string,
  clientId: string,
  sessionCookie: string,
  codeChallenge: string,
  state: string,
): Promise<AuthorizeOutcome> {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', LOOPBACK_REDIRECT_URI);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', REQUESTED_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('resource', MCP_RESOURCE_URL);

  // Node's fetch always sends `Accept: */*`, and better-auth's authorize
  // route only emits a real HTTP 302 for navigation-shaped requests
  // (browser-style Accept/Sec-Fetch-Mode headers); anything else -- like our
  // Accept: */* -- gets the same decision back as a 200 JSON body
  // `{redirect, url}` instead of a Location header. Handle both shapes.
  const res = await fetch(url, { headers: { Cookie: sessionCookie } });
  let location = res.headers.get('location') ?? '';
  if (!location && res.status === 200) {
    const body = (await res.json()) as { redirect?: boolean; url?: string };
    location = body.url ?? '';
  }

  let outcome: AuthorizeOutcome = { location };
  let destination = 'unrecognized';
  if (location.includes('/consent')) {
    destination = 'consent page';
    outcome.consentRedirectQuery = location.split('?')[1] ?? '';
  } else if (location.startsWith(LOOPBACK_REDIRECT_URI)) {
    const code = new URL(location).searchParams.get('code');
    if (code) {
      destination = 'client callback with code (consent auto-skipped)';
      outcome.code = code;
    } else {
      destination = 'client callback with error';
    }
  } else if (location.includes('/login')) {
    destination = 'login page (session not recognized)';
  }

  const pass = !!location && (destination === 'consent page' || destination.startsWith('client callback with code'));
  record(
    6,
    'Authorize with session cookie + PKCE',
    pass,
    `${res.status} -> ${destination}`,
    truncate(location, 400),
  );
  if (!pass) throw new Error(`step 6: authorize did not reach consent or an issued code (${destination})`);
  return outcome;
}

async function step7_consent(asOrigin: string, sessionCookie: string, oauthQuery: string, expectedState: string): Promise<string> {
  const res = await fetch(`${asOrigin}/oauth2/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: asOrigin, Cookie: sessionCookie },
    body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
  });
  const body = (await res.json()) as { redirect?: boolean; url?: string; redirect_uri?: string };
  const redirectUrl = body.url ?? body.redirect_uri;
  let code: string | undefined;
  if (redirectUrl) {
    const parsed = new URL(redirectUrl);
    code = parsed.searchParams.get('code') ?? undefined;
    const returnedState = parsed.searchParams.get('state');
    if (returnedState !== expectedState) {
      record(7, 'POST /oauth2/consent {accept:true}', false, `${res.status}`, `state mismatch: sent ${expectedState}, got ${returnedState}`);
      throw new Error('step 7: state mismatch on consent redirect');
    }
  }
  const pass = res.ok && !!code;
  record(7, 'POST /oauth2/consent {accept:true}', pass, `${res.status} ${res.statusText}`, JSON.stringify(body));
  if (!code) throw new Error(`step 7: consent did not yield an authorization code: ${JSON.stringify(body)}`);
  return code;
}

async function step8_exchangeToken(
  tokenEndpoint: string,
  asOrigin: string,
  code: string,
  clientId: string,
  codeVerifier: string,
): Promise<string | undefined> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: LOOPBACK_REDIRECT_URI,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: asOrigin },
    body: body.toString(),
  });
  const text = await res.text();
  let parsed: { access_token?: string } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    // non-JSON error body (e.g. a bare Fastify content-type-parser rejection)
  }
  const pass = res.ok && !!parsed.access_token;
  record(
    8,
    'POST token_endpoint (grant_type=authorization_code, form-urlencoded per spec)',
    pass,
    `${res.status} ${res.statusText}`,
    truncate(text),
  );
  if (!pass) return undefined;
  const { payload } = decodeJwt(parsed.access_token!);
  console.log(`       decoded access_token claims: ${truncate(JSON.stringify(payload), 400)}`);
  return parsed.access_token;
}

async function step9_callMcp(accessToken: string): Promise<void> {
  const init = await mcpPost(
    MCP_RESOURCE_URL,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'neon-mcp-e2e-test', version: '0.1.0' },
      },
    },
    { bearerToken: accessToken },
  );
  const initOk = init.status === 200 && init.messages.some((m) => 'result' in m && !!m.result);
  if (!initOk) {
    record(9, 'MCP initialize + tools/call whoami', false, `initialize -> ${init.status}`, truncate(init.rawBody));
    return;
  }

  await mcpPost(
    MCP_RESOURCE_URL,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { bearerToken: accessToken, sessionId: init.sessionId },
  );

  const call = await mcpPost(
    MCP_RESOURCE_URL,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } },
    { bearerToken: accessToken, sessionId: init.sessionId },
  );
  const result = call.messages.find((m) => m.id === 2);
  const pass = call.status === 200 && !!result?.result && !result.error;
  record(9, 'MCP initialize + tools/call whoami', pass, `tools/call -> ${call.status}`, truncate(JSON.stringify(result)));
}

async function main() {
  console.log(`Target MCP resource: ${MCP_RESOURCE_URL}`);
  console.log(`Loopback redirect_uri: ${LOOPBACK_REDIRECT_URI}\n`);

  const { verifier, challenge } = newPkcePair();
  const state = randomState();

  const resourceMetadataUrl = await step1_discoverProtectedResource();
  const asOrigin = await step2_fetchProtectedResourceMetadata(resourceMetadataUrl);
  const asMeta = await step3_fetchAsMetadata(asOrigin);
  const clientId = await step4_registerClient(asMeta.registration_endpoint, asOrigin);
  const sessionCookie = await step5_establishSession(asOrigin);
  const authOutcome = await step6_authorize(asMeta.authorization_endpoint, clientId, sessionCookie, challenge, state);

  const code =
    authOutcome.code ??
    (await step7_consent(asOrigin, sessionCookie, authOutcome.consentRedirectQuery ?? '', state));

  const accessToken = await step8_exchangeToken(asMeta.token_endpoint, asOrigin, code, clientId, verifier);

  if (accessToken) {
    await step9_callMcp(accessToken);
  } else {
    record(9, 'MCP initialize + tools/call whoami', false, 'SKIPPED', 'blocked: step 8 did not produce an access token');
  }
}

main()
  .then(() => {
    const results = getResults();
    const firstFailure = results.find((r) => !r.pass);
    console.log('\n=== Summary ===');
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}. ${r.name}`);
    if (firstFailure) {
      console.log(`\nFirst failing hop: ${firstFailure.n}. ${firstFailure.name} (${firstFailure.status})`);
      process.exitCode = 1;
    } else {
      console.log('\nAll hops passed.');
    }
  })
  .catch((err) => {
    console.error('\nFATAL:', err instanceof Error ? err.message : err);
    const results = getResults();
    console.log('\n=== Summary (partial run) ===');
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}. ${r.name}`);
    process.exitCode = 1;
  });
