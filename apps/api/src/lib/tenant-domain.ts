import { env } from "../config.js";
import { AppError } from "./http.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export function normalizeTenantHost(value: string | null | undefined) {
  if (!value) return null;
  const withoutProtocol = value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
  return withoutProtocol.replace(/:\d+$/, "").replace(/\.$/, "") || null;
}

export function platformWebHost() {
  try {
    return new URL(env.WEB_URL).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return normalizeTenantHost(env.WEB_URL);
  }
}

export function customDomainFromSettings(settings: unknown, validate = false) {
  const whiteLabel = record(record(settings).whiteLabel);
  const raw = typeof whiteLabel.customDomain === "string" ? whiteLabel.customDomain.trim().toLowerCase() : "";
  if (!raw) return null;
  const normalized = normalizeTenantHost(raw) ?? "";

  if (validate) {
    if (raw !== normalized || !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)) {
      throw new AppError(422, "INVALID_CUSTOM_DOMAIN", "Enter a normalized custom domain such as erp.school.com without protocol or path");
    }

    const baseHost = platformWebHost();
    const reservedHosts = new Set([
      baseHost,
      baseHost ? `www.${baseHost}` : null,
      baseHost ? `api.${baseHost}` : null,
      baseHost ? `app.${baseHost}` : null,
      baseHost ? `staging.${baseHost}` : null,
      baseHost ? `main-staging.${baseHost}` : null,
    ].filter((value): value is string => Boolean(value)));

    if (reservedHosts.has(normalized)) {
      throw new AppError(422, "CUSTOM_DOMAIN_RESERVED", "This hostname is reserved by the platform and cannot be assigned to an organization");
    }
  }

  return normalized || null;
}

export function tenantSlugFromHost(value: string | null | undefined) {
  const host = normalizeTenantHost(value);
  const baseHost = platformWebHost();
  if (!host || !baseHost || host === baseHost || !host.endsWith(`.${baseHost}`)) return null;

  const prefix = host.slice(0, -(baseHost.length + 1));
  if (!prefix || prefix.includes(".")) return null;

  const reserved = new Set(["www", "app", "api", "staging", "main-staging"]);
  if (reserved.has(prefix) || !/^[a-z0-9-]{2,80}$/.test(prefix)) return null;
  return prefix;
}

export function tenantPortalBaseUrl(settings: unknown) {
  const customDomain = customDomainFromSettings(settings);
  return customDomain ? `https://${customDomain}` : env.WEB_URL.replace(/\/$/, "");
}
