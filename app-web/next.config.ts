import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * next-auth v4 reads NEXTAUTH_URL from its precompiled package when it
   * constructs an OAuth provider callback. On Vercel, leaving that reference
   * to runtime environment detection can make the App Router bundle fall back
   * to VERCEL_URL — the immutable, per-deployment hostname — even when a
   * branch-scoped NEXTAUTH_URL points at a stable Preview alias.
   *
   * Inline only this public origin at build time so the client and server
   * copies of next-auth agree on the same canonical URL. Vercel supplies the
   * branch-scoped value for Preview and the Production-scoped value for
   * Production, so no deployment hostname is hardcoded here. Secrets must
   * never be added to this `env` block because Next.js exposes these values to
   * the browser bundle.
   */
  env: process.env.NEXTAUTH_URL
    ? { NEXTAUTH_URL: process.env.NEXTAUTH_URL }
    : undefined,
};

export default nextConfig;
