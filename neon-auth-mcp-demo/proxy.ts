import { auth } from "@/lib/auth/server";

// Next.js's middleware convention file (formerly middleware.ts, renamed to
// proxy.ts). Validates/refreshes the session cookie and redirects
// unauthenticated requests to /login.
export default auth.middleware({
  loginUrl: "/login",
});

export const config = {
  // Only the authenticated landing page is gated; /login, /consent, and the
  // /api/auth proxy route must stay reachable while signed out.
  matcher: ["/"],
};
