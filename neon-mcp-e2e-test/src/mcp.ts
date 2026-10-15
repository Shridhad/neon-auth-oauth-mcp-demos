// Minimal hand-rolled MCP streamable-HTTP client: just enough of the wire
// protocol (JSON-RPC 2.0 over a POST that may answer as a single JSON body
// or as an SSE stream of `data:` frames) to drive initialize + tools/call
// against the resource server the way a real MCP client would.

type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export type McpResponse = {
  status: number;
  sessionId?: string;
  messages: JsonRpcMessage[];
  rawBody: string;
};

function parseSseFrames(body: string): JsonRpcMessage[] {
  const messages: JsonRpcMessage[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload) continue;
    messages.push(JSON.parse(payload));
  }
  return messages;
}

export async function mcpPost(
  url: string,
  message: JsonRpcMessage,
  opts: { bearerToken: string; sessionId?: string },
): Promise<McpResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${opts.bearerToken}`,
  };
  if (opts.sessionId) headers['Mcp-Session-Id'] = opts.sessionId;

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(message) });
  const rawBody = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  let messages: JsonRpcMessage[] = [];
  if (rawBody) {
    messages = contentType.includes('text/event-stream') ? parseSseFrames(rawBody) : [JSON.parse(rawBody)];
  }
  return {
    status: res.status,
    sessionId: res.headers.get('mcp-session-id') ?? undefined,
    messages,
    rawBody,
  };
}
