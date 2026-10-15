import pg from 'pg';

import { TODOS_DATABASE_URL } from './config.js';

/**
 * The tenant database serves a self-signed certificate, so verification is
 * disabled here explicitly rather than relying on NODE_TLS_REJECT_UNAUTHORIZED
 * in the npm scripts. pg lets a URL `sslmode` override the `ssl` option (and
 * treats `require` as `verify-full`), so it is removed from the URL for the
 * `ssl` setting below to take effect. TLS is still used.
 */
function connectionStringWithoutSslMode(raw: string): string {
  const url = new URL(raw);
  url.searchParams.delete('sslmode');
  return url.toString();
}

/**
 * One pool for the process: every request shares connections, and identity is
 * carried by query parameters, never by connection state.
 */
export const pool = new pg.Pool({
  connectionString: connectionStringWithoutSslMode(TODOS_DATABASE_URL),
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('Idle todos database client error:', err);
});

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
}

// bigserial ids come back from pg as strings (they can exceed 2^53), and
// timestamptz as Date; normalise both so tool output is stable JSON.
interface TodoRow {
  id: string;
  title: string;
  done: boolean;
  created_at: Date;
}

function toTodo(row: TodoRow): Todo {
  return { id: row.id, title: row.title, done: row.done, created_at: row.created_at.toISOString() };
}

export async function listTodos(sub: string, includeDone: boolean): Promise<Todo[]> {
  const { rows } = await pool.query<TodoRow>(
    `select id, title, done, created_at
       from public.todos
      where user_id = $1 and ($2::boolean or not done)
      order by created_at desc, id desc`,
    [sub, includeDone],
  );
  return rows.map(toTodo);
}

export async function addTodo(sub: string, title: string): Promise<Todo> {
  const { rows } = await pool.query<TodoRow>(
    `insert into public.todos (user_id, title)
     values ($1, $2)
     returning id, title, done, created_at`,
    [sub, title],
  );
  return toTodo(rows[0]);
}

/** Returns the deleted todo, or undefined if no row with that id belongs to `sub`. */
export async function removeTodo(sub: string, id: string): Promise<Todo | undefined> {
  const { rows } = await pool.query<TodoRow>(
    `delete from public.todos
      where id = $1 and user_id = $2
     returning id, title, done, created_at`,
    [id, sub],
  );
  return rows[0] ? toTodo(rows[0]) : undefined;
}
