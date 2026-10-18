import { schoolOSFeatures } from "./schoolos-feature-policy.js";
import type { SchoolOSQuoteItem } from "./schoolos-quotation.js";

export type SchoolOSAddonRateCategory = "MODULE" | "CAPACITY" | "AI_USAGE" | "VIDEO_USAGE" | "IMPLEMENTATION";
export const schoolOSAddonCategories = ["MODULE", "CAPACITY", "AI_USAGE", "VIDEO_USAGE", "IMPLEMENTATION"] as const;
const moduleCodes = new Set<string>(schoolOSFeatures.map(x => x.key));
const capacityCodes = new Set(["students", "users", "branches", "storage_gb"]);
const implementationCodes = new Set(["onboarding", "migration", "training"]);

export function isSupportedSchoolOSAddon(category: string, code: string): category is SchoolOSAddonRateCategory {
  if (category === "MODULE") return moduleCodes.has(code);
  if (category === "CAPACITY") return capacityCodes.has(code);
  if (category === "AI_USAGE") return code === "ai_credits";
  if (category === "VIDEO_USAGE") return code === "video_minutes";
  if (category === "IMPLEMENTATION") return implementationCodes.has(code);
  return false;
}

export type SchoolOSAddonRate = {
  id: string;
  category: string;
  code: string;
  revision: number;
  label: string;
  unitPricePaise: number;
  currency: string;
  taxRateBps: number;
  status: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
};

export function schoolOSAddonWindowOverlaps(
  first: { effectiveFrom: Date; effectiveUntil: Date | null },
  second: { effectiveFrom: Date; effectiveUntil: Date | null },
) {
  return first.effectiveFrom.getTime() < (second.effectiveUntil?.getTime() ?? Infinity)
    && second.effectiveFrom.getTime() < (first.effectiveUntil?.getTime() ?? Infinity);
}

export function validateSchoolOSApprovedAddonLines(
  items: SchoolOSQuoteItem[], rates: SchoolOSAddonRate[], options: {
    currency: string; taxRateBps: number; now: Date; validUntil: Date;
  },
) {
  if (!items.length) return [] as Array<{
    rateId: string; revision: number; category: string; code: string; unitPricePaise: number;
    currency: string; taxRateBps: number; effectiveFrom: string; effectiveUntil: string | null;
  }>;
  if (options.currency !== "INR") throw new Error("SCHOOLOS_ADDON_CURRENCY_UNSUPPORTED");
  const seen = new Set<string>();
  return items.map(item => {
    const identity = `${item.category}:${item.code}`;
    if (seen.has(identity)) throw new Error("SCHOOLOS_ADDON_DUPLICATE_LINE");
    seen.add(identity);
    if (!isSupportedSchoolOSAddon(item.category, item.code))
      throw new Error("SCHOOLOS_ADDON_NOT_CATALOGUED");
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100_000)
      throw new Error("SCHOOLOS_ADDON_QUANTITY_INVALID");
    const eligible = rates.filter(rate =>
      rate.category === item.category && rate.code === item.code &&
      rate.status === "APPROVED" && rate.approvedAt !== null &&
      rate.approvedBy && rate.approvedBy !== rate.createdBy &&
      rate.effectiveFrom.getTime() <= options.now.getTime() &&
      (rate.effectiveUntil === null || rate.effectiveUntil.getTime() >= options.validUntil.getTime())
    );
    if (eligible.length !== 1) throw new Error("SCHOOLOS_ADDON_APPROVED_RATE_REQUIRED");
    const [rate] = eligible;
    if (rate!.currency !== options.currency || rate!.taxRateBps !== options.taxRateBps)
      throw new Error("SCHOOLOS_ADDON_TAX_OR_CURRENCY_MISMATCH");
    if (!Number.isSafeInteger(rate!.unitPricePaise) || rate!.unitPricePaise <= 0
      || rate!.unitPricePaise !== item.unitPricePaise || rate!.label !== item.label)
      throw new Error("SCHOOLOS_ADDON_SIGNED_PRICE_MISMATCH");
    return {
      rateId: rate!.id, revision: rate!.revision, category: rate!.category,
      code: rate!.code, unitPricePaise: rate!.unitPricePaise,
      currency: rate!.currency, taxRateBps: rate!.taxRateBps,
      effectiveFrom: rate!.effectiveFrom.toISOString(),
      effectiveUntil: rate!.effectiveUntil?.toISOString() ?? null,
    };
  });
}
