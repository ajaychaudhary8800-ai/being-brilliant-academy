import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Windows without Developer Mode cannot create the symlinks used by the
  // standalone tracer. CI and Docker keep the production standalone default;
  // local verification can opt into the standard production output.
  output: process.env.NEXT_OUTPUT_MODE === "standard" ? undefined : "standalone",

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
