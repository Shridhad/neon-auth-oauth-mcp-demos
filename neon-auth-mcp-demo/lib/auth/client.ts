"use client";

import { createAuthClient } from "@neondatabase/neon-js/auth/next";

// No baseUrl needed here: client calls go to the same-origin
// /api/auth/[...path] route, which proxies to NEON_AUTH_BASE_URL server-side.
export const authClient = createAuthClient();
