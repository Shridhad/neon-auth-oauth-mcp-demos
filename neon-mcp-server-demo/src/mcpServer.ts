import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { addTodo, listTodos, removeTodo } from './db.js';

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * Database failures are logged in full server-side but reported to the client
 * generically, so connection details and SQL never reach the agent.
 */
async function withDb(op: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (err) {
    console.error(`${op} failed:`, err);
    return toolError(`${op} failed due to a database error.`);
  }
}

/**
 * Builds a fresh MCP server instance for a single request. Stateless mode
 * (see index.ts's `sessionIdGenerator: undefined`) creates one server +
 * transport per HTTP request, so a new instance here is cheap and avoids
 * sharing state across unrelated callers.
 */
/**
 * `sub` is the verified token subject for this request only. Tools close over
 * it instead of reading identity from tool input, so a client can never act on
 * another user's todos by naming them.
 */
export function createMcpServer(sub: string): McpServer {
  const server = new McpServer({
    name: 'neon-mcp-server-demo',
    version: '0.1.0',
  });

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Returns the authenticated caller\'s identity as verified from the OAuth bearer token (sub, client_id, scopes, aud). Proves the MCP OAuth flow succeeded.',
    },
    async (extra) => {
      const authInfo = extra.authInfo;
      if (!authInfo) {
        // The /mcp route in index.ts always runs createMcpProtectedRequestHandler
        // ahead of the MCP transport, so this only happens if that wiring is
        // ever removed.
        throw new Error('whoami called without verified auth info');
      }

      const claims = authInfo.extra?.claims as Record<string, unknown> | undefined;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                sub: claims?.sub,
                client_id: authInfo.clientId,
                scopes: authInfo.scopes,
                aud: claims?.aud,
                iss: claims?.iss,
                exp: authInfo.expiresAt,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_todos',
    {
      title: 'List todos',
      description: "Lists the authenticated user's todos, newest first.",
      inputSchema: {
        include_done: z
          .boolean()
          .optional()
          .describe('Include completed todos. Defaults to true.'),
      },
    },
    async ({ include_done }) =>
      withDb('list_todos', async () => jsonResult(await listTodos(sub, include_done ?? true))),
  );

  server.registerTool(
    'add_todo',
    {
      title: 'Add todo',
      description: 'Adds a todo for the authenticated user and returns it.',
      inputSchema: {
        title: z.string().describe('Todo text. Leading and trailing whitespace is trimmed.'),
      },
    },
    async ({ title }) => {
      const trimmed = title.trim();
      if (trimmed === '') {
        return toolError('title must not be empty or whitespace-only.');
      }
      return withDb('add_todo', async () => jsonResult(await addTodo(sub, trimmed)));
    },
  );

  server.registerTool(
    'remove_todo',
    {
      title: 'Remove todo',
      description: "Deletes one of the authenticated user's todos by id.",
      inputSchema: {
        // Clients differ in whether they send numeric ids as numbers or strings.
        id: z
          .union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]*$/)])
          .describe('Id of the todo to delete, as returned by list_todos or add_todo.'),
      },
    },
    async ({ id }) =>
      withDb('remove_todo', async () => {
        // Ids are a global sequence; an id owned by another user must be
        // indistinguishable from one that does not exist.
        const removed = await removeTodo(sub, String(id));
        return removed ? jsonResult({ removed }) : toolError(`Todo ${String(id)} not found.`);
      }),
  );

  return server;
}
