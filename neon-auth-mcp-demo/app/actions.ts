"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";
import { addTodo, removeTodo, setTodoDone } from "@/lib/todos";

import type { AddTodoState } from "./add-todo-form";

export async function signOutAction() {
  await auth.signOut();
  redirect("/login");
}

// The user id always comes from the server-side session, never from the
// client: todo ids are a global sequence, so a client-supplied user id would
// let one user act on another's rows.
async function requireUserId(): Promise<string> {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect("/login");
  }
  return session.user.id;
}

const MAX_TITLE_LENGTH = 500;

export async function addTodoAction(
  _prev: AddTodoState,
  formData: FormData,
): Promise<AddTodoState> {
  const userId = await requireUserId();
  const title = String(formData.get("title") ?? "").trim();
  if (title.length === 0) {
    return { error: "Title cannot be empty." };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.` };
  }
  await addTodo(userId, title);
  revalidatePath("/");
  return {};
}

export async function toggleTodoAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  const done = formData.get("done") === "true";
  // ids are bigserial; anything else is a forged or corrupted form.
  if (/^\d+$/.test(id)) {
    await setTodoDone(userId, id, done);
  }
  revalidatePath("/");
}

export async function removeTodoAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (/^\d+$/.test(id)) {
    await removeTodo(userId, id);
  }
  revalidatePath("/");
}
