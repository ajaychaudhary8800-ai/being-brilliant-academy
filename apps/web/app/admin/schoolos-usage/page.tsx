"use client";

import { useEffect, useState } from "react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Client = { id: string; name: string; slug: string };
type Balance = { id: string; metric: string; periodStart: string; periodEnd: string; grantedUnits: number; consumedUnits: number; remainingUnits: number };
type Activity = { metric: string; kind: string; units: number; createdAt: string };
type Report = { balances: Balance[]; events: Activity[]; meteringConnected: boolean; activationStatus: string; financeReviewRequired: boolean; riskHolds: { invoiceId: string; firstEventType: string; latestEventType: string; openedAt: string }[] };

async function get(path: string) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } });
  const result = await res.json().catch(() => null);
  if (!res.ok) throw new Error(result?.error?.message ?? "Unable to retrieve usage");
  return result.data;
}
export default function SchoolOSUsagePage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void get("/platform/organizations?limit=100").then((tenants: Client[]) => {
      if (!active) return;
      const eligible = tenants.filter(tenant => tenant.id !== "org_default");
      setClients(eligible);
      setSelected(eligible[0]?.id ?? "");
    }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setReport(null); setError("");
    void get(`/platform/schoolos/usage/${encodeURIComponent(selected)}`)
      .then((result: Report) => { if (active) setReport(result); })
      .catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [selected]);

  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="SchoolOS Metered Usage" description="Read-only per-client prepaid AI/video ledger. Usage enforcement is not yet connected to production provider jobs.">
    {error && <p role="alert" className="mt-5 rounded-lg border border-red-300 p-3 text-red-700">{error}</p>}
    <label className="mt-5 block text-sm font-semibold">Customer organization
      <select value={selected} onChange={event => setSelected(event.target.value)} className="mt-2 block w-full rounded-lg border p-2 dark:bg-slate-900">
        {clients.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name} — {tenant.slug}</option>)}
      </select>
    </label>
    {report && <div className="mt-5 space-y-5">
      {report.financeReviewRequired && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950">
        <p className="font-bold">Finance review required — customer add-ons temporarily suspended</p>
        <p>Captured refund or dispute evidence has been recorded. Existing debits and credits are preserved for reconciliation.</p>
        <ul className="mt-2 list-disc pl-5">{report.riskHolds.map(hold =>
          <li key={hold.invoiceId}>Invoice {hold.invoiceId}: {hold.latestEventType} ({new Date(hold.openedAt).toLocaleDateString("en-IN")})</li>
        )}</ul>
      </div>}
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        Provider usage metering is not yet connected to live AI Examiner or video workers. A zero balance here does not establish actual provider usage.
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <h2 className="p-4 font-bold">Purchased credit periods</h2>
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead><tr className="border-t"><th className="p-3">Metric</th><th className="p-3">Period</th><th className="p-3">Granted</th><th className="p-3">Consumed</th><th className="p-3">Remaining</th></tr></thead>
          <tbody>{report.balances.map(item => <tr key={item.id} className="border-t">
            <td className="p-3">{item.metric.replaceAll("_", " ")}</td>
            <td className="p-3">{new Date(item.periodStart).toLocaleDateString("en-IN")} – {new Date(item.periodEnd).toLocaleDateString("en-IN")}</td>
            <td className="p-3">{item.grantedUnits}</td><td className="p-3">{item.consumedUnits}</td><td className="p-3 font-semibold">{item.remainingUnits}</td>
          </tr>)}</tbody>
        </table>
        {report.balances.length === 0 && <p className="p-4 text-sm text-slate-500">No metered credit ledger recorded for this client.</p>}
      </div>
      <div className="overflow-x-auto rounded-xl border"><h2 className="p-4 font-bold">Latest ledger events</h2>
        <table className="w-full text-left text-sm"><thead><tr className="border-t"><th className="p-3">Date</th><th className="p-3">Metric</th><th className="p-3">Event</th><th className="p-3">Units</th></tr></thead>
          <tbody>{report.events.map((event, index) => <tr key={index} className="border-t">
            <td className="p-3">{new Date(event.createdAt).toLocaleString("en-IN")}</td>
            <td className="p-3">{event.metric}</td><td className="p-3">{event.kind}</td><td className="p-3">{event.units}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
  </ProtectedAdminWorkspace>;
}
