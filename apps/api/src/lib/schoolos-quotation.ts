/** SchoolOS V5 — quotation calculations in integer paise. Never alters subscriptions. */
export type SchoolOSQuoteItem = {
  category: "MODULE" | "CAPACITY" | "AI_USAGE" | "VIDEO_USAGE" | "IMPLEMENTATION" | "CUSTOM_WORK";
  code: string;
  label: string;
  quantity: number;
  unitPricePaise: number;
};
export type SchoolOSQuoteBreakdown = {
  basePaise: number; addonsPaise: number; subtotalPaise: number;
  discountBps: number; discountPaise: number; netPaise: number;
  taxRateBps: number; taxPaise: number; totalPaise: number;
};
const MAX_INTEGER_PAISE = 2_147_483_647n;
function exactInt(value: number, field: string, max: bigint): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) > max)
    throw new RangeError(`${field} must be a nonnegative integer within supported pricing limits`);
  return BigInt(value);
}
function cappedPaise(value: bigint, field: string): number {
  if (value < 0n || value > MAX_INTEGER_PAISE)
    throw new RangeError(`${field} exceeds supported invoice amount`);
  return Number(value);
}
export function calculateSchoolOSQuote(input: {
  basePricePaise: number; items: SchoolOSQuoteItem[]; discountBps: number; taxRateBps: number;
}): SchoolOSQuoteBreakdown {
  const base = exactInt(input.basePricePaise, "basePricePaise", MAX_INTEGER_PAISE);
  const discountBps = exactInt(input.discountBps, "discountBps", 10_000n);
  const taxRateBps = exactInt(input.taxRateBps, "taxRateBps", 10_000n);
  if (input.items.length > 60) throw new RangeError("Quote has too many line items");
  let addons = 0n;
  const keys = new Set<string>();
  for (const item of input.items) {
    const key = `${item.category}:${item.code}`;
    if (keys.has(key)) throw new RangeError(`Duplicate quote item: ${key}`);
    keys.add(key);
    addons += exactInt(item.quantity, "quantity", 100_000n)
      * exactInt(item.unitPricePaise, "unitPricePaise", MAX_INTEGER_PAISE);
  }
  const subtotal = base + addons;
  const discount = (subtotal * discountBps + 5_000n) / 10_000n;
  const net = subtotal - discount;
  const tax = (net * taxRateBps + 5_000n) / 10_000n;
  return {
    basePaise: cappedPaise(base, "base"), addonsPaise: cappedPaise(addons, "add-ons"),
    subtotalPaise: cappedPaise(subtotal, "subtotal"), discountBps: Number(discountBps),
    discountPaise: cappedPaise(discount, "discount"), netPaise: cappedPaise(net, "net"),
    taxRateBps: Number(taxRateBps), taxPaise: cappedPaise(tax, "GST"),
    totalPaise: cappedPaise(net + tax, "total"),
  };
}
