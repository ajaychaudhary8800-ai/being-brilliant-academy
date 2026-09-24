"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export type TenantBranding = {
  organizationId: string | null;
  slug: string;
  name: string;
  appName: string;
  portalName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  loginHeadline: string;
  loginSubheadline: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  customDomain: string | null;
  hideVendorBranding: boolean;
};

const defaults: TenantBranding = {
  organizationId: null,
  slug: "being-brilliant-academy",
  name: "Being Brilliant Academy",
  appName: "Being Brilliant Academy",
  portalName: "Admin Portal",
  logoUrl: null,
  faviconUrl: null,
  primaryColor: "#1155cc",
  secondaryColor: "#0f172a",
  accentColor: "#ff7a00",
  loginHeadline: "Welcome back",
  loginSubheadline: null,
  supportEmail: null,
  supportPhone: null,
  customDomain: null,
  hideVendorBranding: false,
};

type BrandingContextValue = {
  brand: TenantBranding;
  hostBound: boolean;
  resolveWorkspace: (slug: string) => Promise<TenantBranding | null>;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string | null = null) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalize(payload: unknown): TenantBranding {
  const source = record(payload);
  const settings = record(source.settings);
  const whiteLabel = record(source.whiteLabel ?? settings.whiteLabel);
  const name = stringValue(source.name, defaults.name) ?? defaults.name;
  return {
    organizationId: stringValue(source.organizationId ?? source.id),
    slug: stringValue(source.slug, defaults.slug) ?? defaults.slug,
    name,
    appName: stringValue(whiteLabel.appName, name) ?? name,
    portalName: stringValue(whiteLabel.portalName, "Admin Portal") ?? "Admin Portal",
    logoUrl: stringValue(source.logoUrl),
    faviconUrl: stringValue(whiteLabel.faviconUrl),
    primaryColor: stringValue(source.primaryColor, defaults.primaryColor) ?? defaults.primaryColor,
    secondaryColor: stringValue(source.secondaryColor, defaults.secondaryColor) ?? defaults.secondaryColor,
    accentColor: stringValue(whiteLabel.accentColor, defaults.accentColor) ?? defaults.accentColor,
    loginHeadline: stringValue(whiteLabel.loginHeadline, defaults.loginHeadline) ?? defaults.loginHeadline,
    loginSubheadline: stringValue(whiteLabel.loginSubheadline),
    supportEmail: stringValue(whiteLabel.supportEmail),
    supportPhone: stringValue(whiteLabel.supportPhone),
    customDomain: stringValue(whiteLabel.customDomain),
    hideVendorBranding: whiteLabel.hideVendorBranding !== false,
  };
}

function hexRgb(hex: string, fallback: [number, number, number]) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return fallback;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as [number, number, number];
}

function mix(rgb: [number, number, number], target: [number, number, number], ratio: number) {
  return rgb.map((value, index) => Math.round(value + (target[index] - value) * ratio)) as [number, number, number];
}

function triplet(value: [number, number, number]) {
  return value.join(" ");
}

function applyBrand(brand: TenantBranding) {
  const root = document.documentElement;
  const primary = hexRgb(brand.primaryColor, [17, 85, 204]);
  root.style.setProperty("--brand-50", triplet(mix(primary, [255, 255, 255], 0.92)));
  root.style.setProperty("--brand-500", triplet(primary));
  root.style.setProperty("--brand-700", triplet(mix(primary, [0, 0, 0], 0.22)));
  root.style.setProperty("--brand-accent", triplet(hexRgb(brand.accentColor, [255, 122, 0])));
  root.style.setProperty("--tenant-secondary", triplet(hexRgb(brand.secondaryColor, [15, 23, 42])));
  document.title = brand.appName;

  const faviconUrl = brand.faviconUrl ?? brand.logoUrl;
  if (faviconUrl) {
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.href = faviconUrl;
  }
}

async function fetchPublic(params: URLSearchParams) {
  const response = await fetch(`${API}/public/branding?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) return null;
  const json = await response.json().catch(() => null);
  return json?.data ? normalize(json.data) : null;
}

export function TenantBrandingProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [brand, setBrand] = useState<TenantBranding>(defaults);
  const [hostBound, setHostBound] = useState(false);

  const commit = useCallback((next: TenantBranding, bound?: boolean) => {
    setBrand(next);
    if (bound !== undefined) setHostBound(bound);
    applyBrand(next);
    return next;
  }, []);

  const resolveWorkspace = useCallback(async (slug: string) => {
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (clean.length < 2) return null;
    const resolved = await fetchPublic(new URLSearchParams({ slug: clean })).catch(() => null);
    return resolved ? commit(resolved, false) : null;
  }, [commit]);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    void (async () => {
      if (user) {
        const resolved = await fetchPublic(new URLSearchParams({ organizationId: user.organizationId })).catch(() => null);
        if (!cancelled && resolved) commit(resolved, true);
        return;
      }
      const resolved = await fetchPublic(new URLSearchParams({ host: window.location.host })).catch(() => null);
      if (!cancelled && resolved) commit(resolved);
    })();
    return () => { cancelled = true; };
  }, [commit, loading, user]);


  const value = useMemo(() => ({ brand, hostBound, resolveWorkspace }), [brand, hostBound, resolveWorkspace]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useTenantBranding() {
  const context = useContext(BrandingContext);
  if (!context) throw new Error("useTenantBranding must be used inside TenantBrandingProvider");
  return context;
}
