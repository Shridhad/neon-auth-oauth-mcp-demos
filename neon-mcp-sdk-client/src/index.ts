import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

const MCP_RESOURCE_URL = process.env.MCP_RESOURCE_URL ?? 'http://localhost:31100/mcp';
const HOST = '127.0.0.1';
const PORT = 33418;
const REDIRECT_URL = `http://${HOST}:${PORT}/callback`;
const DIR = '/tmp/neon-mcp-sdk-client';
const STATE_FILE = `${DIR}/state.json`;
const URL_FILE = `${DIR}/authorize-url.txt`;
const WAIT_MS = 10 * 60 * 1000;

mkdirSync(DIR, { recursive: true });
if (process.env.FRESH !== '0' && existsSync(STATE_FILE)) rmSync(STATE_FILE); // default: fresh DCR + login each run; FRESH=0 reuses

interface Persisted {
  clientInfo?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
}
const persisted: Persisted = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(persisted, null, 2));

let results = 0;
let failures = 0;
function step(name: string, ok: boolean, detail: string) {
  results++;
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail.replace(/\s+/g, ' ').slice(0, 300)}`);
}

// The callback listener must be up before the user is sent to the browser.
let resolveCode!: (code: string) => void;
let rejectCode!: (e: Error) => void;
const codePromise = new Promise<string>((res, rej) => {
  resolveCode = res;
  rejectCode = rej;
});
codePromise.catch(() => {}); // avoid unhandled rejection if we fail before awaiting
let expectedState: string | undefined;

const callbackServer = createServer((req, res) => {
  const u = new URL(req.url ?? '/', REDIRECT_URL);
  if (u.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  const error = u.searchParams.get('error');
  res.writeHead(200, { 'content-type': 'text/html' });
  if (error) {
    res.end(`<p>Authorization failed: ${error}. You can close this tab.</p>`);
    rejectCode(new Error(`authorization error: ${error} ${u.searchParams.get('error_description') ?? ''}`));
  } else if (!code || (expectedState && state !== expectedState)) {
    res.end('<p>Invalid callback (missing code or state mismatch).</p>');
    rejectCode(new Error('invalid callback: missing code or state mismatch'));
  } else {
    res.end('<p>Authorized. You can close this tab.</p>');
    resolveCode(code);
  }
});

const authProvider: OAuthClientProvider = {
  get redirectUrl() {
    return REDIRECT_URL;
  },
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'neon-mcp-sdk-client',
      redirect_uris: [REDIRECT_URL],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  },
  state() {
    expectedState = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
    return expectedState;
  },
  clientInformation: () => persisted.clientInfo,
  saveClientInformation(info) {
    persisted.clientInfo = info;
    save();
    step('DCR (saveClientInformation)', true, `client_id=${info.client_id}`);
  },
  tokens: () => persisted.tokens,
  saveTokens(tokens) {
    persisted.tokens = tokens;
    save();
    step('token (saveTokens)', true, `type=${tokens.token_type} scope=${tokens.scope} refresh=${!!tokens.refresh_token}`);
  },
  saveCodeVerifier(v) {
    persisted.verifier = v;
    save();
  },
  codeVerifier() {
    if (!persisted.verifier) throw new Error('no code verifier saved');
    return persisted.verifier;
  },
  redirectToAuthorization(url) {
    writeFileSync(URL_FILE, url.toString() + '\n');
    step('discovery + authorize URL', true, `${url.origin}${url.pathname} resource=${url.searchParams.get('resource')}`);
    console.log('\n==================== OPEN THIS URL IN A BROWSER ====================');
    console.log(url.toString());
    console.log(`(also written to ${URL_FILE}; waiting up to 10 minutes on ${REDIRECT_URL})`);
    console.log('====================================================================\n');
  },
  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'tokens') persisted.tokens = undefined;
    if (scope === 'all' || scope === 'client') persisted.clientInfo = undefined;
    if (scope === 'all' || scope === 'verifier') persisted.verifier = undefined;
    save();
  },
};

function newTransport() {
  return new StreamableHTTPClientTransport(new URL(MCP_RESOURCE_URL), { authProvider });
}
function newClient() {
  return new Client({ name: 'neon-mcp-sdk-client', version: '0.1.0' });
}

async function main() {
  await new Promise<void>((res, rej) => {
    callbackServer.once('error', rej);
    callbackServer.listen(PORT, HOST, res);
  });

  let transport = newTransport();
  let client = newClient();
  try {
    await client.connect(transport);
    step('connect (already authorized)', true, 'no OAuth needed');
  } catch (err) {
    // UnauthorizedError means the SDK finished discovery + DCR and called redirectToAuthorization.
    if (!(err instanceof Error) || (err.name !== 'UnauthorizedError' && err.message !== 'Unauthorized')) {
      step('connect', false, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      return;
    }
    step('connect -> 401 -> OAuth flow started', true, err.message || err.name);
    const timeout = setTimeout(() => rejectCode(new Error('timed out waiting for callback (10 min)')), WAIT_MS);
    let code: string;
    try {
      code = await codePromise;
    } finally {
      clearTimeout(timeout);
    }
    step('callback', true, 'authorization code received');
    await transport.finishAuth(code);
    transport = newTransport();
    client = newClient();
    await client.connect(transport);
    step('reconnect with token', true, 'initialize OK');
  }

  const tools = await client.listTools();
  step('listTools', true, tools.tools.map((t) => t.name).join(', '));
  for (const name of ['whoami', 'list_todos']) {
    try {
      const r = await client.callTool({ name, arguments: {} });
      const text = JSON.stringify(r.content);
      step(`call ${name}`, !r.isError, text);
    } catch (err) {
      step(`call ${name}`, false, String(err));
    }
  }
  await client.close();
}

main()
  .catch((err) => step('run', false, err instanceof Error ? `${err.name}: ${err.message}` : String(err)))
  .finally(() => {
    callbackServer.close();
    console.log(`\n${results - failures}/${results} steps passed`);
    process.exit(failures ? 1 : 0);
  });
