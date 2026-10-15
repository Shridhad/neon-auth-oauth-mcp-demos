import { ConsentForm } from "./ConsentForm";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// The host is the part of a redirect_uri a person can actually recognise, so
// it is the headline identity on a screen whose job is "who am I trusting?".
function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

// Display only: what's shown here is read from the URL, but the decision is
// bound to the signed query, which neon-auth re-verifies on submit.
export default async function ConsentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const clientId = first(query.client_id);
  const scopes = (first(query.scope) ?? "").split(" ").filter(Boolean);
  const resources = all(query.resource);
  const redirectHost = hostOf(first(query.redirect_uri));

  if (!clientId) {
    return (
      <main className="oauth-main">
        <div className="oauth-card">
          <div className="oauth-header">
            <h1 className="oauth-title">Authorize access</h1>
          </div>
          <p className="oauth-error" role="alert">
            This page was opened without an authorization request (no client_id). Start the sign-in
            from the application.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="oauth-main">
      <div className="oauth-card">
        <div className="oauth-header">
          <h1 className="oauth-title">Authorize access</h1>
          <p className="oauth-muted">
            <strong>{redirectHost ?? clientId}</strong> wants to access your account.
          </p>
        </div>

        <dl className="oauth-client">
          <dt>Client</dt>
          <dd>{clientId}</dd>
          {redirectHost && (
            <>
              <dt>Redirects to</dt>
              <dd>{redirectHost}</dd>
            </>
          )}
          {resources.length > 0 && (
            <>
              <dt>Resources</dt>
              <dd>{resources.join(", ")}</dd>
            </>
          )}
          <dt>Scopes</dt>
          <dd>
            {scopes.length > 0 ? (
              <ul className="oauth-scopes">
                {scopes.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            ) : (
              "none requested"
            )}
          </dd>
        </dl>

        <ConsentForm />
      </div>
    </main>
  );
}
