import type { NextConfig } from "next";

// Dashboard only — the API is a separate Bun process (apps/api), reached over NEXT_PUBLIC_API_URL.
// Nothing to configure here: no proxying, since going through Vercel would put a hop on every call
// and make the dashboard's uptime a dependency of the admin UI.
const nextConfig: NextConfig = {
  // Three bun.lock files sit above this one, so Turbopack's root inference picks the API's.
  turbopack: { root: __dirname },
};

export default nextConfig;
