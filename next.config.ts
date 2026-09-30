import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  },
];

const noindexPaths = [
  "/dashboard", "/signals", "/scanner", "/analysis", "/patterns",
  "/account", "/admin", "/admin/:path*", "/login", "/register",
  "/forgot-password", "/reset-password", "/verify-email",
  // Legal drafts are linked for review but must not enter search until approved.
  "/terms", "/privacy", "/refund", "/support",
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Coin Secret keeps a concise discovery stub and the full rules under docs/.
  agentRules: false,
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      // Binance's own logo host. The board is made of Binance pairs and it has
      // a logo for every one of them; the source below covers 138 of the 193.
      {
        protocol: "https",
        hostname: "bin.bnbstatic.com",
        pathname: "/static/assets/logos/**",
      },
      {
        protocol: "https",
        hostname: "assets.coincap.io",
        pathname: "/assets/icons/**",
      },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...noindexPaths.map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex" }] })),
    ];
  },
  async redirects() {
    return [{
      source: "/:path*",
      has: [{ type: "host", value: "www.coinsecret.io" }],
      destination: "https://coinsecret.io/:path*",
      permanent: true,
    }];
  },
};

export default nextConfig;
