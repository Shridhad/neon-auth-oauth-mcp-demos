import { AuthView } from "@neondatabase/auth-ui";

import { OAuthSignInForm, type OAuthClientContext } from "../_components/OAuthSignInForm";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Display only: the signed query is what neon-auth trusts, so nothing here
// needs to be validated beyond being safe to render.
function clientContext(query: SearchParams): OAuthClientContext {
  let redirectHost: string | undefined;
  const redirectUri = first(query.redirect_uri);
  if (redirectUri) {
    try {
      redirectHost = new URL(redirectUri).host;
    } catch {
      redirectHost = undefined;
    }
  }
  return {
    clientId: first(query.client_id),
    redirectHost,
    scopes: (first(query.scope) ?? "").split(" ").filter(Boolean),
  };
}

// Optional catch-all: /login itself renders the sign-in view; /login/sign-up,
// /login/sign-out etc. (linked internally by AuthView) resolve to the
// matching view under the same route.
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<SearchParams>;
}) {
  const { path } = await params;
  const query = await searchParams;
  const view = path?.[0] ?? "sign-in";

  // neon-auth's /oauth2/authorize redirect to loginPage always carries a
  // signed query (`sig`); its presence is what marks an OAuth sign-in.
  if (view === "sign-in" && query.sig) {
    return (
      <main className="oauth-main">
        <OAuthSignInForm client={clientContext(query)} />
      </main>
    );
  }

  return (
    <main>
      <AuthView path={view} />
    </main>
  );
}
