import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Keep production builds separate from the dev server cache. This prevents
  // a `next build` from invalidating chunks served by an active `next dev`.
  distDir: process.env.NODE_ENV === "production" ? ".next-production" : ".next",
  // Windows without Developer Mode cannot create the symlinks used by standalone tracing.
  // CI and production containers run on Linux and always emit the standalone server.
  output: process.platform === "win32" ? undefined : "standalone",
  compress: true,
  productionBrowserSourceMaps: false,
  images: { formats: ["image/avif", "image/webp"], remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }] },
  poweredByHeader: false,
  async headers() { return [{ source: "/:path*", headers: [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ] }]; },
};
export default nextConfig;
