import type { NextConfig } from "next";

// Sent with every page. No Content-Security-Policy on purpose: Next injects inline scripts,
// so a policy strict enough to matter needs per-request nonces, which is out of scope here.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" }, // nobody may frame the panel (clickjacking)
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false, // hides the round Next.js badge in the corner during development
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The browser only ever talks to this Next.js origin. /api/* is forwarded to the NestJS API,
  // so the login cookie is first-party (no cross-site cookie problems between Vercel and Render).
  // This is transport only: every business rule lives in the API.
  async rewrites() {
    const apiUrl = process.env.API_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
