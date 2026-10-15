"use client";

import { useActionState } from "react";

import { addTodoAction } from "./actions";

export interface AddTodoState {
  error?: string;
}

export function AddTodoForm() {
  const [state, formAction, pending] = useActionState(addTodoAction, {});

  return (
    <form action={formAction} className="oauth-stack">
      <div className="oauth-field">
        <label htmlFor="todo-title">New todo</label>
        <input
          id="todo-title"
          name="title"
          className="oauth-input"
          type="text"
          autoComplete="off"
          placeholder="What needs doing?"
        />
      </div>
      {state.error ? <p className="oauth-error">{state.error}</p> : null}
      <button type="submit" className="oauth-button" disabled={pending}>
        Add todo
      </button>
    </form>
  );
}
