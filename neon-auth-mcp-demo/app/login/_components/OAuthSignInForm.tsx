"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { hasActiveSession, postOAuthContinuation } from "@/lib/oauth/continuation";

export type OAuthClientContext = {
  clientId: string | undefined;
  redirectHost: string | undefined;
  scopes: string[];
};

type Mode = "sign-in" | "sign-up";
type Phase = "checking" | "continuing" | "form";

// Used instead of <AuthView> during an OAuth authorize flow: AuthView's
// requests can't carry `oauth_query`, and its onSuccess navigates to "/",
// which would drop the authorize continuation. With `oauth_query` in the
// body, neon-auth resumes /oauth2/authorize inside the response that sets the
// session cookie and hands back the next URL (consent page or redirect_uri).
export function OAuthSignInForm({ client }: { client: OAuthClientContext }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Set when the user opts out of the automatic continue, so a response that
  // lands afterwards doesn't navigate them away from the form they chose.
  const abandoned = useRef(false);
  const started = useRef(false);

  // The session cookie is host-only on this origin, so neon-auth's authorize
  // endpoint never sees it and sends already-signed-in users here. Continuing
  // through the same-origin proxy forwards the cookie; `selected: true` tells
  // the continue endpoint to re-run authorize with that existing session.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      if (!(await hasActiveSession())) {
        if (!abandoned.current) setPhase("form");
        return;
      }
      if (abandoned.current) return;
      setPhase("continuing");
      const result = await postOAuthContinuation("/oauth2/continue", { selected: true });
      if (abandoned.current) return;
      if (result.ok) {
        window.location.href = result.url;
        return;
      }
      setError(result.message);
      setPhase("form");
    })();
  }, []);

  function chooseDifferentAccount() {
    abandoned.current = true;
    setError(null);
    setPhase("form");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result =
      mode === "sign-in"
        ? await postOAuthContinuation("/sign-in/email", { email, password })
        : await postOAuthContinuation("/sign-up/email", { email, password, name });
    if (result.ok) {
      window.location.href = result.url;
      return;
    }
    setError(result.message);
    setPending(false);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  const appLabel = client.redirectHost ?? client.clientId ?? "An application";

  return (
    <div className="oauth-card">
      <header className="oauth-header">
        <h1 className="oauth-title">
          {phase === "form" ? (mode === "sign-in" ? "Sign in to continue" : "Create an account") : "Continuing…"}
        </h1>
        <p className="oauth-muted">
          <strong>{appLabel}</strong> wants to access your account.
        </p>
      </header>

      <dl className="oauth-client">
        {client.clientId && (
          <>
            <dt>Client</dt>
            <dd>
              <code>{client.clientId}</code>
            </dd>
          </>
        )}
        {client.redirectHost && (
          <>
            <dt>Redirects to</dt>
            <dd>{client.redirectHost}</dd>
          </>
        )}
        <dt>Scopes</dt>
        <dd>
          {client.scopes.length > 0 ? (
            <ul className="oauth-scopes">
              {client.scopes.map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            </ul>
          ) : (
            <span className="oauth-muted">none requested</span>
          )}
        </dd>
      </dl>

      {phase !== "form" ? (
        <div className="oauth-stack">
          <p className="oauth-muted" aria-live="polite">
            {phase === "checking" ? "Checking your session…" : "You're already signed in. Continuing to the application…"}
          </p>
          <button type="button" className="oauth-button oauth-button-secondary" onClick={chooseDifferentAccount}>
            Use a different account
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="oauth-stack">
          {mode === "sign-up" && (
            <label className="oauth-field">
              <span>Name</span>
              <input
                className="oauth-input"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label className="oauth-field">
            <span>Email</span>
            <input
              className="oauth-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="oauth-field">
            <span>Password</span>
            <input
              className="oauth-input"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="oauth-button" disabled={pending}>
            {mode === "sign-in"
              ? pending
                ? "Signing in…"
                : "Sign in"
              : pending
                ? "Creating account…"
                : "Create account"}
          </button>
          <p className="oauth-muted oauth-switch">
            {mode === "sign-in" ? "Don't have an account? " : "Already have an account? "}
            <button
              type="button"
              className="oauth-link"
              disabled={pending}
              onClick={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}
            >
              {mode === "sign-in" ? "Create one" : "Sign in"}
            </button>
          </p>
        </form>
      )}

      {error && (
        <p role="alert" className="oauth-error">
          {error}
        </p>
      )}
    </div>
  );
}
