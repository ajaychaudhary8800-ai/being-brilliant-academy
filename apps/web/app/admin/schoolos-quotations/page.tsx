"use client";

import { useEffect, useState } from "react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Plan = { code: string; name: string; isActive: boolean };
type QuoteLine = { category: "MODULE" | "CAPACITY" | "AI_USAGE" | "VIDEO_USAGE" | "IMPLEMENTATION" | "CUSTOM_WORK"; code: string; label: string; quantity: number; unitPricePaise: number };
type Breakdown = { basePaise: number; addonsPaise: number; subtotalPaise: number; discountPaise: number; taxPaise: number; totalPaise: number };
type Quote = { id: string; quoteNo: string; clientName: string; planCode: string; status: string; totalPaise: number; version: number };
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}`, ...init?.headers },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message ?? "Request failed");
  return result.data;
}
const rupees = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const newLine = (): QuoteLine => ({ category: "MODULE", code: "lms", label: "LMS add-on", quantity: 1, unitPricePaise: 0 });

export default function SchoolOSQuotationsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [cycle, setCycle] = useState<"MONTHLY" | "ANNUAL">("ANNUAL");
  const [validity, setValidity] = useState(15);
  const [discountBps, setDiscountBps] = useState(0);
  const [items, setItems] = useState<QuoteLine[]>([]);
  const [preview, setPreview] = useState<Breakdown | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [allPlans, allQuotes] = await Promise.all([api("/platform/saas/plans"), api("/platform/schoolos/quotes")]);
    setPlans(allPlans.filter((plan: Plan) => plan.isActive));
    setQuotes(allQuotes);
    setPlanCode(old => old || allPlans.find((plan: Plan) => plan.isActive)?.code || "");
  }
  useEffect(() => { void load().catch(cause => setError(errorMessage(cause))); }, []);
  const body = () => ({
    clientName, clientEmail: clientEmail.trim() || null, planCode, billingCycle: cycle,
    validUntil: futureDate(validity), items, discountBps,
  });
  async function submit(save: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api(save ? "/platform/schoolos/quotes" : "/platform/schoolos/quotes/preview", {
        method: "POST", body: JSON.stringify(body()),
      });
      if (save) {
        setNotice(`Saved internal draft ${result.quoteNo}. No subscription or payment was activated.`);
        await load();
      } else {
        setPreview(result.pricing);
        setNotice("Estimate calculated using currently configured plan price and tax.");
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  function editLine(index: number, patch: Partial<QuoteLine>) {
    setItems(previous => previous.map((item, i) => i === index ? { ...item, ...patch } : item));
  }
  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="SchoolOS Custom Quotations" description="Platform-only draft calculations. No quotations are sent or paid features activated.">
    {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    <div className="mt-5 grid gap-4 rounded-xl border p-5 md:grid-cols-2">
      <label className="text-sm font-semibold">Client name<input value={clientName} onChange={e => setClientName(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
      <label className="text-sm font-semibold">Client email<input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
      <label className="text-sm font-semibold">Plan<select value={planCode} onChange={e => setPlanCode(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900">{plans.map(plan => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></label>
      <label className="text-sm font-semibold">Billing cycle<select value={cycle} onChange={e => setCycle(e.target.value as "MONTHLY" | "ANNUAL")} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900"><option value="ANNUAL">Annual</option><option value="MONTHLY">Monthly</option></select></label>
      <label className="text-sm font-semibold">Validity (1–90 days)<input type="number" min={1} max={90} value={validity} onChange={e => setValidity(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
      <label className="text-sm font-semibold">Discount (basis points; 500 = 5%)<input type="number" min={0} max={5000} value={discountBps} onChange={e => setDiscountBps(Math.max(0, Math.min(5000, Number(e.target.value) || 0)))} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
    </div>
    <div className="mt-5 overflow-x-auto rounded-xl border">
      <div className="flex items-center justify-between border-b p-4"><h2 className="font-bold">Custom line items</h2><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setItems(list => [...list, newLine()])}>Add item</button></div>
      {items.map((item, index) => <div key={index} className="grid min-w-[740px] grid-cols-[140px_130px_1fr_70px_120px_70px] gap-2 border-b p-3 text-sm">
        <select aria-label="Item category" value={item.category} onChange={e => editLine(index, { category: e.target.value as QuoteLine["category"] })} className="rounded border p-2 dark:bg-slate-900">{(["MODULE","CAPACITY","AI_USAGE","VIDEO_USAGE","IMPLEMENTATION","CUSTOM_WORK"] as const).map(value => <option key={value}>{value}</option>)}</select>
        <input aria-label="Item code" value={item.code} onChange={e => editLine(index, { code: e.target.value })} className="rounded border p-2 dark:bg-slate-900" />
        <input aria-label="Item description" value={item.label} onChange={e => editLine(index, { label: e.target.value })} className="rounded border p-2 dark:bg-slate-900" />
        <input aria-label="Quantity" type="number" min={1} value={item.quantity} onChange={e => editLine(index, { quantity: Number(e.target.value) })} className="rounded border p-2 dark:bg-slate-900" />
        <input aria-label="Unit price in INR" type="number" min={0} value={item.unitPricePaise / 100} onChange={e => editLine(index, { unitPricePaise: Math.round(Number(e.target.value) * 100) })} className="rounded border p-2 dark:bg-slate-900" />
        <button className="rounded border" onClick={() => setItems(list => list.filter((_,i) => i !== index))}>Remove</button>
      </div>)}
      {!items.length && <p className="p-4 text-sm text-slate-500">Add optional modules, capacity or implementation charges.</p>}
    </div>
    <div className="mt-5 flex gap-3">
      <button disabled={busy} onClick={() => void submit(false)} className="rounded-lg border px-4 py-2 font-semibold disabled:opacity-50">Preview estimate</button>
      <button disabled={busy} onClick={() => void submit(true)} className="rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Save internal draft</button>
    </div>
    {preview && <div className="mt-5 rounded-xl border p-4 text-sm">
      Base {rupees(preview.basePaise)} · Add-ons {rupees(preview.addonsPaise)} · Discount {rupees(preview.discountPaise)} · GST {rupees(preview.taxPaise)}
      <p className="mt-2 text-xl font-bold">Estimated total: {rupees(preview.totalPaise)}</p>
    </div>}
    <div className="mt-6 overflow-x-auto rounded-xl border"><h2 className="border-b p-4 font-bold">Saved drafts</h2>
      <table className="w-full min-w-[600px] text-sm"><thead><tr><th className="p-3 text-left">Quote</th><th className="p-3 text-left">Client</th><th className="p-3 text-left">Plan</th><th className="p-3 text-left">Version</th><th className="p-3 text-left">Amount</th></tr></thead>
        <tbody>{quotes.map(quote => <tr key={quote.id} className="border-t"><td className="p-3">{quote.quoteNo}</td><td className="p-3">{quote.clientName}</td><td className="p-3">{quote.planCode}</td><td className="p-3">{quote.version}</td><td className="p-3">{rupees(quote.totalPaise)}</td></tr>)}</tbody>
      </table>
    </div>
    <p className="mt-4 text-sm text-amber-700">Plan prices need commercial reconciliation before issuing quotations. Add-on prices are manual internal estimates, not approved feature catalogue prices.</p>
  </ProtectedAdminWorkspace>;
}
