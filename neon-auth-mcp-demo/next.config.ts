import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack's root to this project so it doesn't walk up to an
  // unrelated package-lock.json in the parent home directory.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
