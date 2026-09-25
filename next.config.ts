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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
