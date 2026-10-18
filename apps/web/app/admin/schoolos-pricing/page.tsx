"use client";
import { useEffect, useState } from "react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { getAccessToken, errorMessage } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Evaluation = { planCode: string; status: string; issues: string[]; expectedAnnualPaise?: number | null; configuredAnnualPaise?: number };
type Response = { reference: { referenceId: string; approvedAt: string }; evaluations: Evaluation[]; productionPricesModified: boolean; externalIssuanceEnabled: boolean };
const currency = (paise: number | null | undefined) => paise === null || paise === undefined ? "Custom" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
export default function PricingReconciliationPage() {
  const [result, setResult] = useState<Response | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = getAccessToken();
    void fetch(`${API}/platform/schoolos/pricing/reconciliation`, { headers: { Authorization: `Bearer ${token ?? ""}` } })
      .then(async response => { const json = await response.json(); if (!response.ok) throw new Error(json?.error?.message ?? "Pricing load failed"); return json.data as Response; })
      .then(setResult).catch(cause => setError(errorMessage(cause)));
  }, []);
  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="SchoolOS Pricing Reconciliation" description="Review proposed launch prices against the configured SaaS plans. No automatic price or subscription changes.">
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-300 p-3 text-sm text-red-700">{error}</p>}
    {result && <section className="mt-5 space-y-4">
      <p className="rounded-xl border p-4 text-sm"><strong>Commercial reference:</strong> {result.reference.referenceId} · Approved: {result.reference.approvedAt}. Production prices unchanged; customer issue disabled until formal reconciliation.</p>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[750px] text-left text-sm">
        <thead><tr className="border-b"><th className="p-3">Plan</th><th className="p-3">Reference annual</th><th className="p-3">Configured annual</th><th className="p-3">Status</th><th className="p-3">Required action</th></tr></thead>
        <tbody>{result.evaluations.map(item => <tr key={item.planCode} className="border-b">
          <td className="p-3 font-semibold">{item.planCode}</td><td className="p-3">{currency(item.expectedAnnualPaise)}</td>
          <td className="p-3">{currency(item.configuredAnnualPaise)}</td><td className="p-3">{item.status.replaceAll("_", " ")}</td>
          <td className="p-3">{item.issues.join("; ") || "None"}</td></tr>)}</tbody>
      </table></div>
      <p className="text-sm text-amber-700">This is a read-only comparison, not permission to change signed contracts or collect payments. Enterprise stays custom-quoted.</p>
    </section>}
  </ProtectedAdminWorkspace>;
}
