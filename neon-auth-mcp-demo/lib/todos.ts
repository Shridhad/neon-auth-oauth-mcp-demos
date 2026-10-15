import { Pool } from "pg";

export interface Todo {
  // bigserial: pg's default int8 parser returns a string.
  id: string;
  title: string;
  done: boolean;
  created_at: Date;
}

// Next dev hot-reloads modules; parking the Pool on a global symbol keeps one
// pool across reloads instead of leaking a new one per reload.
const poolKey = Symbol.for("neon-auth-mcp-demo.todos-pool");

function getPool(): Pool {
  const store = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = store[poolKey];
  if (existing instanceof Pool) {
    return existing;
  }
  const pool = new Pool({
    connectionString: process.env.TODOS_DATABASE_URL,
    // The demo database serves a self-signed certificate.
    ssl: { rejectUnauthorized: false },
  });
  store[poolKey] = pool;
  return pool;
}

export async function listTodos(userId: string): Promise<Todo[]> {
  const res = await getPool().query<Todo>(
    `select id, title, done, created_at
       from public.todos
      where user_id = $1
      order by created_at desc`,
    [userId],
  );
  return res.rows;
}

export async function addTodo(userId: string, title: string): Promise<Todo> {
  const res = await getPool().query<Todo>(
    `insert into public.todos (user_id, title)
     values ($1, $2)
     returning id, title, done, created_at`,
    [userId, title],
  );
  return res.rows[0];
}

// Every mutation is scoped by user_id: todo ids come from a global sequence,
// so an id alone must never be enough to touch a row.
export async function setTodoDone(
  userId: string,
  id: string,
  done: boolean,
): Promise<number> {
  const res = await getPool().query(
    `update public.todos
        set done = $3
      where id = $2::bigint and user_id = $1`,
    [userId, id, done],
  );
  return res.rowCount ?? 0;
}

export async function removeTodo(userId: string, id: string): Promise<number> {
  const res = await getPool().query(
    `delete from public.todos
      where id = $2::bigint and user_id = $1`,
    [userId, id],
  );
  return res.rowCount ?? 0;
}
