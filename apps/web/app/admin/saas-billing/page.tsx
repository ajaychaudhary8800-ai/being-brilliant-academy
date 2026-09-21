"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CreditCard, RefreshCw, Save, Users } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const statuses = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"] as const;
const cycles = ["MONTHLY", "ANNUAL", "CUSTOM"] as const;

type Organization = {
  id: string;
  name: string;
  slug: string;
  email: string;
  subscriptionStatus: string;
  subscriptionPlan: string;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  _count?: { users: number; branches: number };
};

type Plan = { id: string; code: string; name: string; limits: Record<string, number | null>; isActive: boolean };
type Invoice = { id: string; invoiceNo: string; totalPaise: number; currency: string; status: string; createdAt: string; paidAt: string | null };
type Detail = {
  organization: Organization;
  subscription: { id: string; status: string; billingCycle: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  plan: { code: string; name: string; limits: Record<string, number | null> } | null;
  enforcementEnabled: boolean;
  usage: { branches: number; users: number; students: number };
  invoices: Invoice[];
};
type Form = {
  planCode: string;
  status: string;
  billingCycle: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  enforcementEnabled: boolean;
};

const headers = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${getAccessToken() ?? ""}`,
});
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...init?.headers } });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json.data;
}
const dateInput = (value: string | null | undefined) => value ? new Date(value).toISOString().slice(0, 10) : "";
const money = (paise: number, currency: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(paise / 100);

export default function Page() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const loadIndex = useCallback(async () => {
    try {
      const [orgResult, planResult] = await Promise.all([
        api("/platform/organizations?limit=100"),
        api("/platform/saas/plans"),
      ]);
      setOrganizations(orgResult);
      setPlans(planResult);
      setSelectedId(current => current || orgResult.find((org: Organization) => org.id !== "org_default")?.id || orgResult[0]?.id || "");
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  const loadDetail = useCallback(async (organizationId: string) => {
    if (!organizationId) return;
    try {
      const data = await api(`/platform/saas/organizations/${organizationId}`) as Detail;
      setDetail(data);
      setForm({
        planCode: data.plan?.code ?? data.organization.subscriptionPlan ?? plans[0]?.code ?? "STANDARD",
        status: data.subscription?.status ?? data.organization.subscriptionStatus ?? "TRIAL",
        billingCycle: data.subscription?.billingCycle ?? "MONTHLY",
        currentPeriodStart: dateInput(data.subscription?.currentPeriodStart),
        currentPeriodEnd: dateInput(data.subscription?.currentPeriodEnd ?? data.organization.subscriptionEndsAt),
        cancelAtPeriodEnd: data.subscription?.cancelAtPeriodEnd ?? false,
        enforcementEnabled: data.enforcementEnabled,
      });
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [plans]);

  useEffect(() => { void loadIndex(); }, [loadIndex]);
  useEffect(() => { void loadDetail(selectedId); }, [selectedId, loadDetail]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? organizations.filter(org => [org.name, org.slug, org.email].some(value => value.toLowerCase().includes(needle))) : organizations;
  }, [organizations, search]);

  async function save() {
    if (!form || !selectedId) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await api(`/platform/saas/organizations/${selectedId}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({
          planCode: form.planCode,
          status: form.status,
          billingCycle: form.billingCycle,
          currentPeriodStart: form.currentPeriodStart || null,
          currentPeriodEnd: form.currentPeriodEnd || null,
          cancelAtPeriodEnd: form.cancelAtPeriodEnd,
          enforcementEnabled: form.enforcementEnabled,
        }),
      });
      setNotice("Tenant subscription updated and audited.");
      await Promise.all([loadIndex(), loadDetail(selectedId)]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="SaaS Billing" description="Assign plans, control entitlement enforcement, review tenant usage and inspect subscription invoices.">
    {notice && <p className="mt-6 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mt-6 grid gap-5 xl:grid-cols-[360px_1fr]">
      <aside className="card overflow-hidden">
        <div className="border-b p-4"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tenants" className="w-full rounded-xl border p-2.5 dark:bg-slate-900"/></div>
        <div className="max-h-[720px] overflow-y-auto">
          {filtered.map(org => <button key={org.id} onClick={() => setSelectedId(org.id)} className={`block w-full border-b p-4 text-left transition ${selectedId === org.id ? "bg-brand-50 dark:bg-slate-900" : "hover:bg-slate-50 dark:hover:bg-slate-900"}`}>
            <span className="block font-semibold">{org.name}</span>
            <span className="mt-1 block text-xs text-slate-500">{org.slug} · {org.subscriptionPlan} · {org.subscriptionStatus}</span>
          </button>)}
        </div>
      </aside>

      <section className="space-y-5">
        {detail && form ? <>
          <div className="card p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><span className="text-xs font-bold uppercase tracking-wider text-brand-700">Tenant</span><h2 className="mt-1 text-2xl font-bold">{detail.organization.name}</h2><p className="mt-1 text-sm text-slate-500">{detail.organization.email}</p></div>
              <button onClick={() => void loadDetail(selectedId)} className="inline-flex items-center gap-2 self-start rounded-xl border px-3 py-2 text-sm font-semibold"><RefreshCw size={16}/>Refresh</button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Usage label="Branches" value={detail.usage.branches} limit={detail.plan?.limits.branches} icon={<Building2 size={17}/>} />
              <Usage label="Users" value={detail.usage.users} limit={detail.plan?.limits.users} icon={<Users size={17}/>} />
              <Usage label="Students" value={detail.usage.students} limit={detail.plan?.limits.students} icon={<Users size={17}/>} />
            </div>
          </div>

          <div className="card grid gap-4 p-5 md:grid-cols-2">
            <h2 className="text-xl font-bold md:col-span-2">Subscription control</h2>
            <label className="text-sm font-semibold">Plan<select value={form.planCode} onChange={event => setForm(current => current && ({ ...current, planCode: event.target.value }))} className="mt-1 block w-full rounded-xl border p-2.5 font-normal dark:bg-slate-900">{plans.map(plan => <option key={plan.id} value={plan.code}>{plan.name} ({plan.code})</option>)}</select></label>
            <label className="text-sm font-semibold">Status<select value={form.status} onChange={event => setForm(current => current && ({ ...current, status: event.target.value }))} className="mt-1 block w-full rounded-xl border p-2.5 font-normal dark:bg-slate-900">{statuses.map(status => <option key={status}>{status}</option>)}</select></label>
            <label className="text-sm font-semibold">Billing cycle<select value={form.billingCycle} onChange={event => setForm(current => current && ({ ...current, billingCycle: event.target.value }))} className="mt-1 block w-full rounded-xl border p-2.5 font-normal dark:bg-slate-900">{cycles.map(cycle => <option key={cycle}>{cycle}</option>)}</select></label>
            <label className="text-sm font-semibold">Current period start<input type="date" value={form.currentPeriodStart} onChange={event => setForm(current => current && ({ ...current, currentPeriodStart: event.target.value }))} className="mt-1 block w-full rounded-xl border p-2.5 font-normal dark:bg-slate-900"/></label>
            <label className="text-sm font-semibold">Current period end<input type="date" value={form.currentPeriodEnd} onChange={event => setForm(current => current && ({ ...current, currentPeriodEnd: event.target.value }))} className="mt-1 block w-full rounded-xl border p-2.5 font-normal dark:bg-slate-900"/></label>
            <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-900">
              <label className="flex items-center gap-3 font-semibold"><input type="checkbox" checked={form.cancelAtPeriodEnd} onChange={event => setForm(current => current && ({ ...current, cancelAtPeriodEnd: event.target.checked }))}/>Cancel at period end</label>
              <label className="flex items-center gap-3 font-semibold"><input type="checkbox" checked={form.enforcementEnabled} onChange={event => setForm(current => current && ({ ...current, enforcementEnabled: event.target.checked }))}/>Enforce plan features & limits</label>
              <p className="text-xs text-slate-500">Enforcement cannot be enabled if current usage exceeds the selected plan limits.</p>
            </div>
            <button disabled={saving} onClick={() => void save()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-700 p-3 font-semibold text-white disabled:opacity-50 md:col-span-2"><Save size={17}/>{saving ? "Saving…" : "Save Subscription"}</button>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b p-5"><h2 className="text-xl font-bold">Subscription invoices</h2></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:bg-slate-900"><tr><th className="p-3">Invoice</th><th className="p-3">Created</th><th className="p-3">Total</th><th className="p-3">Status</th><th className="p-3">Paid</th></tr></thead><tbody>
              {detail.invoices.map(invoice => <tr key={invoice.id} className="border-t"><td className="p-3 font-semibold">{invoice.invoiceNo}</td><td className="p-3">{new Date(invoice.createdAt).toLocaleDateString("en-IN")}</td><td className="p-3">{money(invoice.totalPaise, invoice.currency)}</td><td className="p-3">{invoice.status}</td><td className="p-3">{invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString("en-IN") : "—"}</td></tr>)}
              {!detail.invoices.length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">No subscription invoices yet.</td></tr>}
            </tbody></table></div>
          </div>
        </> : <div className="card grid min-h-64 place-items-center p-8 text-sm text-slate-500"><CreditCard size={28}/><span>Select a tenant to manage subscription billing.</span></div>}
      </section>
    </div>
  </ProtectedAdminWorkspace>;
}

function Usage({ label, value, limit, icon }: { label: string; value: number; limit: number | null | undefined; icon: React.ReactNode }) {
  return <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">{icon}{label}</div><p className="mt-2 text-xl font-bold">{value}{limit === null || limit === undefined ? "" : ` / ${limit}`}</p></div>;
}
