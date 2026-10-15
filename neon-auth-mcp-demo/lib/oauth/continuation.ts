// Shared by /login and /consent while they're handling a signed
// /oauth2/authorize redirect. The signed query on the current URL IS the
// resume state: neon-auth re-verifies its signature and `exp` on every
// request that carries it, so it's forwarded verbatim rather than parsed or
// trimmed here.
export function currentOAuthQuery(): string {
  return window.location.search.replace(/^\?/, "");
}

export type ContinuationResult = { ok: true; url: string } | { ok: false; message: string };

type ErrorBody = {
  error?: string;
  error_description?: string;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readErrorBody(body: unknown): ErrorBody {
  if (!isRecord(body)) return {};
  const pick = (key: string) => {
    const value = body[key];
    return typeof value === "string" ? value : undefined;
  };
  return { error: pick("error"), error_description: pick("error_description"), message: pick("message") };
}

// A bad signature and an elapsed `exp` both come back as the same
// `invalid_signature`, so `exp` is checked locally to tell the user which one
// it is — an expired link is far more likely than a tampered one.
function isLinkExpired(): boolean {
  const exp = Number(new URLSearchParams(window.location.search).get("exp"));
  return Number.isFinite(exp) && exp > 0 && exp * 1000 < Date.now();
}

function describeError(status: number, body: ErrorBody): string {
  if (body.error === "invalid_signature") {
    return isLinkExpired()
      ? "This authorization link has expired. Go back to the application and start the sign-in again."
      : "This authorization link is invalid (signature check failed). Go back to the application and start the sign-in again.";
  }
  if (body.error_description === "missing oauth query") {
    return "This page was opened without an authorization request. Start the sign-in from the application.";
  }
  if (status === 400 && (body.error_description === "Missing parameters" || body.message === "Missing parameters")) {
    return "The authorization server could not tell how to resume this sign-in (missing continuation parameters). Start the sign-in again from the application.";
  }
  if (status === 401) {
    return "You're not signed in (or your session expired). Sign in again from the application to continue.";
  }
  return body.error_description || body.message || body.error || `Request failed (HTTP ${status}).`;
}

// Posts through the same-origin /api/auth proxy so the session cookie, which
// is host-only on this app's origin, is actually sent.
export async function postOAuthContinuation(
  path: string,
  body: Record<string, unknown>,
): Promise<ContinuationResult> {
  let response: Response;
  try {
    response = await fetch(`/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...body, oauth_query: currentOAuthQuery() }),
    });
  } catch (err) {
    return { ok: false, message: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    return { ok: false, message: describeError(response.status, readErrorBody(json)) };
  }
  if (isRecord(json) && json.redirect === true && typeof json.url === "string") {
    return { ok: true, url: json.url };
  }
  return { ok: false, message: "The server accepted the request but did not return a redirect URL." };
}

// get-session answers `null` (HTTP 200) when signed out. Any failure is
// treated as signed out so the caller falls back to the sign-in form instead
// of dead-ending on a transient error.
export async function hasActiveSession(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/get-session", { credentials: "include", cache: "no-store" });
    if (!response.ok) return false;
    const json: unknown = await response.json().catch(() => null);
    return isRecord(json) && isRecord(json.session);
  } catch {
    return false;
  }
}
