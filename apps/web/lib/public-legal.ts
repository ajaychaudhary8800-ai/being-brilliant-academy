import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type PublicLegalDocumentId = "privacy" | "terms" | "acceptable-use";

const documents: Record<PublicLegalDocumentId, { file: string; title: string; description: string }> = {
  privacy: {
    file: "07_PRIVACY_NOTICE.md",
    title: "Privacy Notice",
    description: "How Being Brilliant handles personal data for the website, demos, accounts, support and institution-controlled platform data.",
  },
  terms: {
    file: "03_SAAS_MASTER_AGREEMENT.md",
    title: "SaaS Terms",
    description: "The controlled Being Brilliant SaaS Master Agreement for institutional customers.",
  },
  "acceptable-use": {
    file: "08_ACCEPTABLE_USE_POLICY.md",
    title: "Acceptable Use Policy",
    description: "Rules for lawful, secure and authorized use of the Being Brilliant platform.",
  },
};

export function publicLegalPagesPublished() {
  return process.env.NEXT_PUBLIC_LEGAL_PAGES_PUBLISHED === "true" && Boolean(process.env.LEGAL_EFFECTIVE_DATE?.trim());
}

export function publicLegalEffectiveDate() {
  return process.env.LEGAL_EFFECTIVE_DATE?.trim() ?? "";
}

export function publicLegalDefinition(id: PublicLegalDocumentId) {
  return documents[id];
}

export async function loadPublicLegalSource(id: PublicLegalDocumentId) {
  const item = documents[id];
  const roots = [
    resolve(process.cwd(), "docs/legal-sales"),
    resolve(process.cwd(), "../../docs/legal-sales"),
  ];

  let lastError: unknown;
  for (const root of roots) {
    try {
      const raw = await readFile(resolve(root, item.file), "utf8");
      return raw.replaceAll("[[DATE]]", publicLegalEffectiveDate());
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Controlled legal source unavailable");
}
