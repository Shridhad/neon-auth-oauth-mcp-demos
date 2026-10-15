"use client";

import { useState } from "react";

import { postOAuthContinuation } from "@/lib/oauth/continuation";

// Allow and Deny both go through /oauth2/consent: on deny neon-auth returns
// the client's redirect_uri with error=access_denied, so the client learns
// the outcome either way.
export function ConsentForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function decide(accept: boolean) {
    setError(null);
    setPending(true);
    const result = await postOAuthContinuation("/oauth2/consent", { accept });
    if (result.ok) {
      window.location.href = result.url;
      return;
    }
    setError(result.message);
    setPending(false);
  }

  return (
    <div className="oauth-stack">
      <div className="oauth-actions">
        <button
          type="button"
          className="oauth-button oauth-button-secondary"
          disabled={pending}
          onClick={() => decide(false)}
        >
          Deny
        </button>
        <button type="button" className="oauth-button" disabled={pending} onClick={() => decide(true)}>
          {pending ? "Authorizing…" : "Allow"}
        </button>
      </div>
      {error && (
        <p className="oauth-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
