import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The browser only ever talks to this Next.js origin. /api/* is forwarded to the NestJS API,
  // so the login cookie is first-party (no cross-site cookie problems between Vercel and Render).
  // This is transport only: every business rule lives in the API.
  async rewrites() {
    const apiUrl = process.env.API_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
