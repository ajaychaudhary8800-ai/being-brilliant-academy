"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Edit3, Plus, X } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPricePaise: number;
  annualPricePaise: number;
  trialDays: number;
  currency: string;
  taxRateBps: number;
  entitlements: Record<string, boolean>;
  limits: Record<string, number | null>;
  isActive: boolean;
};

type Form = {
  code: string;
  name: string;
  description: string;
  monthlyPrice: string;
  annualPrice: string;
  trialDays: string;
  currency: string;
  taxPercent: string;
  entitlements: string;
  limits: string;
  isActive: boolean;
};

const empty: Form = {
  code: "",
  name: "",
  description: "",
  monthlyPrice: "0",
  annualPrice: "0",
  trialDays: "0",
  currency: "INR",
  taxPercent: "0",
  entitlements: JSON.stringify({ "*": true }, null, 2),
  limits: JSON.stringify({}, null, 2),
  isActive: true,
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

const money = (paise: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(paise / 100);

export default function Page() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlans(await api("/platform/saas/plans"));
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setShow(true);
    setError("");
  }

  function openEdit(plan: Plan) {
    setEditing(plan);
    setForm({
      code: plan.code,
      name: plan.name,
      description: plan.description ?? "",
      monthlyPrice: String(plan.monthlyPricePaise / 100),
      annualPrice: String(plan.annualPricePaise / 100),
      trialDays: String(plan.trialDays ?? 0),
      currency: plan.currency,
      taxPercent: String(plan.taxRateBps / 100),
      entitlements: JSON.stringify(plan.entitlements ?? {}, null, 2),
      limits: JSON.stringify(plan.limits ?? {}, null, 2),
      isActive: plan.isActive,
    });
    setShow(true);
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const entitlements = JSON.parse(form.entitlements) as Record<string, boolean>;
      const limits = JSON.parse(form.limits) as Record<string, number | null>;
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        monthlyPricePaise: Math.round(Number(form.monthlyPrice) * 100),
        annualPricePaise: Math.round(Number(form.annualPrice) * 100),
        trialDays: Math.max(0, Math.floor(Number(form.trialDays))),
        currency: form.currency.trim().toUpperCase(),
        taxRateBps: Math.round(Number(form.taxPercent) * 100),
        entitlements,
        limits,
        isActive: form.isActive,
      };
      await api(editing ? `/platform/saas/plans/${editing.id}` : "/platform/saas/plans", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      setShow(false);
      setEditing(null);
      setForm(empty);
      setNotice(editing ? "Plan updated." : "Plan created.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="SaaS Plans" description="Configure commercial plans, prices, tax, entitlements and usage limits.">
    <div className="my-6 flex justify-end">
      <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 font-semibold text-white">
        <Plus size={17}/>New Plan
      </button>
    </div>
    {notice && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    {show && <form onSubmit={save} className="card mb-6 grid gap-4 p-5 md:grid-cols-2">
      <div className="flex items-center justify-between md:col-span-2">
        <h2 className="text-lg font-bold">{editing ? "Edit Plan" : "Create Plan"}</h2>
        <button type="button" onClick={() => setShow(false)} aria-label="Close"><X size={18}/></button>
      </div>
      <Field label="Code" value={form.code} onChange={value => setForm(current => ({ ...current, code: value.toUpperCase() }))} />
      <Field label="Name" value={form.name} onChange={value => setForm(current => ({ ...current, name: value }))} />
      <Field label="Monthly price" type="number" step="0.01" value={form.monthlyPrice} onChange={value => setForm(current => ({ ...current, monthlyPrice: value }))} />
      <Field label="Annual price" type="number" step="0.01" value={form.annualPrice} onChange={value => setForm(current => ({ ...current, annualPrice: value }))} />
      <Field label="Default trial days" type="number" step="1" value={form.trialDays} onChange={value => setForm(current => ({ ...current, trialDays: value }))} />
      <Field label="Currency" value={form.currency} onChange={value => setForm(current => ({ ...current, currency: value.toUpperCase() }))} />
      <Field label="Tax %" type="number" step="0.01" value={form.taxPercent} onChange={value => setForm(current => ({ ...current, taxPercent: value }))} />
      <label className="text-sm font-semibold md:col-span-2">Description
        <textarea className="mt-1 min-h-20 w-full rounded-xl border p-3 font-normal dark:bg-slate-900" value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))}/>
      </label>
      <label className="text-sm font-semibold">Entitlements JSON
        <textarea className="mt-1 min-h-44 w-full rounded-xl border p-3 font-mono text-xs font-normal dark:bg-slate-900" value={form.entitlements} onChange={event => setForm(current => ({ ...current, entitlements: event.target.value }))}/>
      </label>
      <label className="text-sm font-semibold">Limits JSON
        <textarea className="mt-1 min-h-44 w-full rounded-xl border p-3 font-mono text-xs font-normal dark:bg-slate-900" value={form.limits} onChange={event => setForm(current => ({ ...current, limits: event.target.value }))}/>
      </label>
      <label className="flex items-center gap-3 text-sm font-semibold md:col-span-2">
        <input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))}/>
        Available for subscription
      </label>
      <button disabled={saving} className="rounded-xl bg-brand-700 p-3 font-semibold text-white disabled:opacity-50 md:col-span-2">
        {saving ? "Saving…" : "Save Plan"}
      </button>
    </form>}

    <div className="grid gap-4 lg:grid-cols-2">
      {plans.map(plan => <article key={plan.id} className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-brand-700">{plan.code}</span>
            <h2 className="mt-1 text-xl font-bold">{plan.name}</h2>
            <p className="mt-2 text-sm text-slate-500">{plan.description || "No description"}</p>
          </div>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${plan.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {plan.isActive ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <Metric label="Monthly" value={money(plan.monthlyPricePaise, plan.currency)} />
          <Metric label="Annual" value={money(plan.annualPricePaise, plan.currency)} />
          <Metric label="Trial" value={plan.trialDays > 0 ? `${plan.trialDays} days` : "Manual/no default"} />
          <Metric label="Tax" value={`${(plan.taxRateBps / 100).toFixed(2)}%`} />
          <Metric label="Limits" value={Object.keys(plan.limits ?? {}).length ? Object.entries(plan.limits).map(([key, value]) => `${key}: ${value ?? "∞"}`).join(", ") : "Unlimited"} />
        </div>
        <button onClick={() => openEdit(plan)} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-brand-700"><Edit3 size={16}/>Edit</button>
      </article>)}
    </div>
  </ProtectedAdminWorkspace>;
}

function Field({ label, value, onChange, type = "text", step }: { label: string; value: string; onChange: (value: string) => void; type?: string; step?: string }) {
  return <label className="text-sm font-semibold">{label}
    <input required type={type} step={step} min={type === "number" ? "0" : undefined} value={value} onChange={event => onChange(event.target.value)} className="mt-1 block w-full rounded-xl border p-2.5 font-normal dark:bg-slate-900"/>
  </label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><span className="text-xs text-slate-500">{label}</span><p className="mt-1 font-semibold">{value}</p></div>;
}
