import type { MetadataRoute } from "next";
import { headers } from "next/headers";

type PublicBranding = {
  name?: string;
  logoUrl?: string | null;
  primaryColor?: string;
  whiteLabel?: { appName?: string | null; faviconUrl?: string | null };
};

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const host = (await headers()).get("host") ?? "";
  const api = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  let brand: PublicBranding | null = null;

  if (api && host) {
    const response = await fetch(`${api}/public/branding?host=${encodeURIComponent(host)}`, { cache: "no-store" }).catch(() => null);
    const json = response?.ok ? await response.json().catch(() => null) : null;
    brand = json?.data ?? null;
  }

  const name = brand?.whiteLabel?.appName?.trim() || brand?.name?.trim() || "Education Portal";
  const icon = brand?.whiteLabel?.faviconUrl || brand?.logoUrl;
  return {
    id: "/",
    name,
    short_name: name.slice(0, 24),
    description: "Education ERP, LMS and institutional portal.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: brand?.primaryColor || "#1155cc",
    orientation: "portrait-primary",
    categories: ["education"],
    icons: icon ? [{ src: icon, sizes: "any", purpose: "any" }] : [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Portals", short_name: "Portals", url: "/login" },
      { name: "Dashboard", short_name: "Dashboard", url: "/dashboard" },
    ],
  };
}
