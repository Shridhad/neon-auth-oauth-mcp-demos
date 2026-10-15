import { createNeonAuth } from "@neondatabase/neon-js/auth/next/server";

// Single server-side entry point: provides .handler() for the API proxy
// route, .middleware() for route protection, and all Better Auth server
// methods (getSession, signIn, signOut, ...).
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
  },
});
