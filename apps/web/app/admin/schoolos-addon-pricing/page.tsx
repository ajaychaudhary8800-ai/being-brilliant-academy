"use client";

import { useEffect, useState } from "react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { getAccessToken, errorMessage } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type RateCategory = "MODULE" | "CAPACITY" | "AI_USAGE" | "VIDEO_USAGE" | "IMPLEMENTATION";
type Rate = { id: string; category: RateCategory; code: string; revision: number; label: string; status: string;
  unitPricePaise: number; taxRateBps: number; effectiveFrom: string; effectiveUntil: string | null;
  createdBy: string; approvedBy: string | null; approvalReference: string | null; };
const CATEGORIES: RateCategory[] = ["MODULE", "CAPACITY", "AI_USAGE", "VIDEO_USAGE", "IMPLEMENTATION"];
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
async function api(path: string, options?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...options, headers: { Authorization: `Bearer ${getAccessToken() ?? ""}`,
      "Content-Type": "application/json", ...options?.headers },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message ?? "Request failed");
  return result.data;
}
export default function AddonPricingPage() {
  const [rates, setRates] = useState<Rate[]>([]);
  const [category, setCategory] = useState<RateCategory>("AI_USAGE");
  const [code, setCode] = useState("ai_credits");
  const [label, setLabel] = useState("AI Credits");
  const [rupees, setRupees] = useState("1.50");
  const [taxRate, setTaxRate] = useState(18);
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("Independently approved commercial add-on rate");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function reload() { setRates(await api("/platform/schoolos/addon-rates")); }
  useEffect(() => { void reload().catch(e => setError(errorMessage(e))); }, []);

  async function create() {
    setBusy(true); setError(""); setNotice("");
    try {
      const price = Number(rupees) * 100;
      if (!Number.isSafeInteger(price) || price <= 0) throw new Error("Enter an exact, positive price (maximum two decimal places).");
      await api("/platform/schoolos/addon-rates", {
        method: "POST",
        body: JSON.stringify({ category, code: code.trim(), label: label.trim(),
          unitPricePaise: price, taxRateBps: Math.round(taxRate * 100),
          effectiveFrom: new Date(`${start}T00:00:00.000Z`).toISOString(),
          effectiveUntil: end ? new Date(`${end}T23:59:59.999Z`).toISOString() : null }),
      });
      setNotice("Rate revision saved as DRAFT. A different platform administrator must approve the price.");
      await reload();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function approve(rate: Rate) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/platform/schoolos/addon-rates/${encodeURIComponent(rate.id)}/approve`, {
        method: "POST", body: JSON.stringify({ approvalReference: reference.trim(), reason: notes.trim() }),
      });
      setNotice(`Approved ${rate.category}:${rate.code} revision ${rate.revision}. Customer checkout remains disabled for custom add-ons.`);
      await reload();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="SchoolOS Add-on Rate Catalogue" description="Finance-approved, versioned pricing. Rate proposals require independent maker-checker approval; nothing is billed here.">
    {error && <p role="alert" className="mt-4 rounded-lg border border-red-400 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p className="mt-4 rounded-lg border border-emerald-400 p-3 text-sm text-emerald-700">{notice}</p>}
    <section className="mt-5 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">New draft price revision</h2>
      <p className="mt-1 text-sm text-slate-500">Only commercially authorised INR amounts should be proposed. Previous approved revisions remain immutable.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="text-sm font-medium">Category
          <select value={category} onChange={e=>setCategory(e.target.value as RateCategory)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900">{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
        </label>
        <label className="text-sm font-medium">SKU code<input value={code} onChange={e=>setCode(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
        <label className="text-sm font-medium">Description<input value={label} onChange={e=>setLabel(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
        <label className="text-sm font-medium">Unit price (₹ ex GST)<input type="number" min="0.01" step="0.01" value={rupees} onChange={e=>setRupees(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
        <label className="text-sm font-medium">GST rate (%)<input type="number" min={0} max={100} step="0.01" value={taxRate} onChange={e=>setTaxRate(Number(e.target.value))} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
        <label className="text-sm font-medium">Start date<input type="date" value={start} onChange={e=>setStart(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
        <label className="text-sm font-medium">Expiry date (optional)<input type="date" value={end} onChange={e=>setEnd(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
      </div>
      <button disabled={busy} onClick={() => void create()} className="mt-4 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50">Submit draft revision</button>
    </section>
    <section className="mt-5 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Independent approval</h2>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium">Finance approval reference<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Approved pricing decision or finance ticket" className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
        <label className="text-sm font-medium">Reason<input value={notes} onChange={e=>setNotes(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" /></label>
      </div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[750px] text-left text-sm">
        <thead><tr className="border-b"><th className="p-2">SKU</th><th className="p-2">Revision</th><th className="p-2">Rate ex GST</th><th className="p-2">Tax</th><th className="p-2">Window</th><th className="p-2">Status</th><th className="p-2">Action</th></tr></thead>
        <tbody>{rates.map(rate=><tr className="border-b" key={rate.id}>
          <td className="p-2">{rate.label}<span className="block text-xs text-slate-500">{rate.category}:{rate.code}</span></td>
          <td className="p-2">{rate.revision}</td><td className="p-2">{money(rate.unitPricePaise)}</td><td className="p-2">{rate.taxRateBps / 100}%</td>
          <td className="p-2">{new Date(rate.effectiveFrom).toLocaleDateString("en-IN")} – {rate.effectiveUntil ? new Date(rate.effectiveUntil).toLocaleDateString("en-IN") : "Open"}</td>
          <td className="p-2">{rate.status}</td>
          <td className="p-2">{rate.status === "DRAFT" && <button disabled={busy || reference.trim().length < 12 || notes.trim().length < 12}
            onClick={() => void approve(rate)} className="rounded-lg border px-3 py-1 disabled:opacity-40">Approve*</button>}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="mt-3 text-xs text-amber-700">*The author cannot approve their own revision. Every approval is audited. Payment-linked add-on activation is a separate future step.</p>
    </section>
  </ProtectedAdminWorkspace>;
}
