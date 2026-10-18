import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedSchoolOSAddon, schoolOSAddonWindowOverlaps, validateSchoolOSApprovedAddonLines, type SchoolOSAddonRate } from "./schoolos-addon-pricing-policy.js";
const now = new Date("2026-10-18T12:00:00Z");
const expires = new Date("2026-11-15T12:00:00Z");
const rate: SchoolOSAddonRate = { id: "r-1", category: "AI_USAGE", code: "ai_credits", revision: 1,
  label: "AI Credits", unitPricePaise: 150, currency: "INR", taxRateBps: 1800, status: "APPROVED",
  effectiveFrom: new Date("2026-10-15"), effectiveUntil: new Date("2026-12-31"),
  createdBy: "maker", approvedBy: "checker", approvedAt: now };
const item = { category: "AI_USAGE" as const, code: "ai_credits", label: "AI Credits", quantity: 200, unitPricePaise: 150 };
const opts = { currency: "INR", taxRateBps: 1800, now, validUntil: expires };
test("only named catalogued add-on SKUs are supported", () => {
  assert.equal(isSupportedSchoolOSAddon("AI_USAGE", "ai_credits"), true);
  assert.equal(isSupportedSchoolOSAddon("VIDEO_USAGE", "video_minutes"), true);
  assert.equal(isSupportedSchoolOSAddon("MODULE", "lms"), true);
  assert.equal(isSupportedSchoolOSAddon("CAPACITY", "students"), true);
  assert.equal(isSupportedSchoolOSAddon("CAPACITY", "ai_credits"), false);
  assert.equal(isSupportedSchoolOSAddon("CUSTOM_WORK", "anything"), false);
});
test("approved maker-checker rate and immutable unit pricing are accepted for a draft", () => {
  const result = validateSchoolOSApprovedAddonLines([item], [rate], opts);
  assert.equal(result[0]?.rateId, rate.id);
  assert.equal(result[0]?.revision, 1);
  assert.equal(result[0]?.unitPricePaise, 150);
});
test("draft, self-approved, expired or conflicting rate cannot enter quotation", () => {
  assert.throws(() => validateSchoolOSApprovedAddonLines([item], [], opts), /APPROVED_RATE_REQUIRED/);
  assert.throws(() => validateSchoolOSApprovedAddonLines([item], [{ ...rate, status: "DRAFT" }], opts), /APPROVED_RATE_REQUIRED/);
  assert.throws(() => validateSchoolOSApprovedAddonLines([item], [{ ...rate, approvedBy: "maker" }], opts), /APPROVED_RATE_REQUIRED/);
  assert.throws(() => validateSchoolOSApprovedAddonLines([item], [{ ...rate, effectiveUntil: now }], opts), /APPROVED_RATE_REQUIRED/);
  assert.throws(() => validateSchoolOSApprovedAddonLines([item], [rate, { ...rate, id: "r-2" }], opts), /APPROVED_RATE_REQUIRED/);
});
test("price, label, tax and currency tampering are blocked", () => {
  assert.throws(() => validateSchoolOSApprovedAddonLines([{ ...item, unitPricePaise: 0 }], [rate], opts), /SIGNED_PRICE_MISMATCH/);
  assert.throws(() => validateSchoolOSApprovedAddonLines([{ ...item, label: "Changed" }], [rate], opts), /SIGNED_PRICE_MISMATCH/);
  assert.throws(() => validateSchoolOSApprovedAddonLines([item], [{ ...rate, taxRateBps: 500 }], opts), /TAX_OR_CURRENCY_MISMATCH/);
  assert.throws(() => validateSchoolOSApprovedAddonLines([item], [rate], { ...opts, currency: "USD" }), /CURRENCY_UNSUPPORTED/);
});
test("strict rate validity windows refuse overlapping published versions", () => {
  assert.equal(schoolOSAddonWindowOverlaps({effectiveFrom:new Date("2026-11-01"),effectiveUntil:new Date("2026-12-01")},{effectiveFrom:new Date("2026-11-15"),effectiveUntil:null}),true);
  assert.equal(schoolOSAddonWindowOverlaps({effectiveFrom:new Date("2026-11-01"),effectiveUntil:new Date("2026-12-01")},{effectiveFrom:new Date("2026-12-01"),effectiveUntil:null}),false);
});
