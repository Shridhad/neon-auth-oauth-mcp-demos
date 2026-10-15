import { auth } from "@/lib/auth/server";

// Proxies every /api/auth/* call to the upstream neon-auth server. This is
// also where the Safari cookie fix lives (strips Partitioned, normalizes
// SameSite=None -> Lax) so the session cookie works as first-party here.
export const { GET, POST } = auth.handler();
