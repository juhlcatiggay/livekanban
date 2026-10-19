import type { NextConfig } from "next";

/**
 * Security headers for every page. A board's URL is its only credential, so:
 * - Referrer-Policy keeps the path (the board id) out of requests to other sites;
 * - frame-ancestors / X-Frame-Options stop other sites framing a board to
 *   trick someone into clicking "Delete";
 * - the rest turn off things the app never uses.
 * A script-src CSP would need per-request nonces, which partial prerendering
 * can't serve from the static shell; user text is never rendered as HTML.
 */
const securityHeaders = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
