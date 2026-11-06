import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Do not write AGENTS.md into the project on dev start.
  agentRules: false,
  // The dev badge sits over the bottom-left of dense screens.
  devIndicators: false,
  // Pin the root so a lockfile in a parent folder cannot change how the app is traced.
  outputFileTracingRoot: path.resolve(__dirname),
  turbopack: { root: path.resolve(__dirname) },
  serverExternalPackages: ["xlsx"],
  /**
   * Dev server only, no effect on Vercel. Next blocks its own dev scripts for any host but localhost,
   * which leaves the page unhydrated and dead when reviewed by IP. This allows IPv4 hosts. For a
   * named host, set PRISM_DEV_ORIGINS to a comma-separated list before `npm run dev`.
   */
  allowedDevOrigins: ["127.0.0.1", "*.*.*.*", ...(process.env.PRISM_DEV_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [])],
};

export default nextConfig;
