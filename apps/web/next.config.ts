import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker requests standalone output. Nixpacks uses standard output so
  // `next start` can run the workspace directly.
  output: process.env.NEXT_OUTPUT_MODE === "standalone" ? "standalone" : undefined,

  /**
   * General optimizations.
   */
  compress: true,
  productionBrowserSourceMaps: false,
  poweredByHeader: false,

  /**
   * Image configuration.
   */
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },

  /**
   * Security headers.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
