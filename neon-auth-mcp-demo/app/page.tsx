import Link from "next/link";

import { AddTodoForm } from "./add-todo-form";
import { removeTodoAction, signOutAction, toggleTodoAction } from "./actions";
import { auth } from "@/lib/auth/server";
import { listTodos } from "@/lib/todos";

// Server components using `auth` methods must be rendered dynamically.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { data: session } = await auth.getSession();

  // proxy.ts already redirects unauthenticated requests to /login for this
  // route; this fallback only covers the gap between an expired cookie and
  // the middleware's next check.
  if (!session?.user) {
    return (
      <main>
        <p>Not signed in.</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  }

  const todos = await listTodos(session.user.id);
  const openCount = todos.filter((todo) => !todo.done).length;

  return (
    <main className="todo-main">
      <header className="oauth-header">
        <h1 className="oauth-title">Todos</h1>
        <p className="oauth-muted">
          Signed in as {session.user.name || session.user.email}
        </p>
        <p className="oauth-muted">
          This list is also reachable over MCP — both surfaces share one store.
        </p>
      </header>

      <AddTodoForm />

      {todos.length === 0 ? (
        <p className="oauth-muted">No todos yet. Add your first one above.</p>
      ) : (
        <>
          <p className="oauth-muted">
            {openCount} open of {todos.length}
          </p>
          <ul className="todo-list">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className="todo-item"
                data-done={todo.done || undefined}
              >
                <span className="todo-title">{todo.title}</span>
                <span className="todo-actions">
                  <form action={toggleTodoAction}>
                    <input type="hidden" name="id" value={todo.id} />
                    <input
                      type="hidden"
                      name="done"
                      value={String(!todo.done)}
                    />
                    <button type="submit" className="todo-button">
                      {todo.done ? "Reopen" : "Done"}
                    </button>
                  </form>
                  <form action={removeTodoAction}>
                    <input type="hidden" name="id" value={todo.id} />
                    <button
                      type="submit"
                      className="todo-button todo-button-danger"
                    >
                      Remove
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <form action={signOutAction}>
        <button type="submit" className="oauth-button oauth-button-secondary">
          Sign out
        </button>
      </form>
    </main>
  );
}
