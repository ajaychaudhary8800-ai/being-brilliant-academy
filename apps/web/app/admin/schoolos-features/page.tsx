"use client";

import { useCallback, useEffect, useState } from "react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

type Client = { id: string; name: string; slug: string };
type Feature = {
  key: string; name: string; group: string; includedInPlan: boolean; enabled: boolean;
  source: string; override: { enabled: boolean; reason: string; expiresAt: string | null } | null;
};
type Details = { name: string; planCode: string; enforcementEnabled: boolean; features: Feature[] };
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${getAccessToken() ?? ""}`, "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Request failed");
  return payload.data;
}

export default function SchoolOSFeatureLicensingPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState("");
  const [details, setDetails] = useState<Details | null>(null);
  const [reason, setReason] = useState("Approved client-specific module configuration");
  const [trialDays, setTrialDays] = useState(30);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const reload = useCallback(async (id: string) => {
    if (!id) return;
    const next = await api(`/platform/schoolos/organizations/${id}/features`);
    setDetails(next);
  }, []);

  useEffect(() => {
    let active = true;
    void api("/platform/organizations?limit=100")
      .then((items: Client[]) => {
        if (!active) return;
        setClients(items.filter(item => item.id !== "org_default"));
        setSelected(old => old || items.find(item => item.id !== "org_default")?.id || "");
      })
      .catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setDetails(null); setError(""); setMessage("");
    void reload(selected).catch(cause => setError(errorMessage(cause)));
  }, [selected, reload]);

  async function changeFeature(feature: Feature, enabled: boolean | null) {
    if (!selected) return;
    setBusy(feature.key); setError(""); setMessage("");
    try {
      const isTrial = enabled === true && !feature.includedInPlan;
      const expiresAt = isTrial ? new Date(Date.now() + trialDays * 86_400_000).toISOString() : null;
      await api(`/platform/schoolos/organizations/${selected}/features/${feature.key}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled, reason: reason.trim(), expiresAt }),
      });
      await reload(selected);
      setMessage(`${feature.name} updated for this client. API entitlement checks take effect immediately.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }

  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="SchoolOS Feature Licensing" description="Platform-only client module overrides. Paid access follows the subscription; temporary trials expire automatically.">
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    <div className="mt-5 grid gap-4 rounded-xl border p-4 md:grid-cols-2">
      <label className="text-sm font-semibold">Client
        <select aria-label="Client" value={selected} onChange={event => setSelected(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900">
          {clients.map(client => <option key={client.id} value={client.id}>{client.name} — {client.slug}</option>)}
        </select>
      </label>
      <label className="text-sm font-semibold">Trial period (maximum 60 days)
        <input type="number" min={1} max={60} value={trialDays} onChange={event => setTrialDays(Math.min(60, Math.max(1, Number(event.target.value) || 1)))} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" />
      </label>
      <label className="text-sm font-semibold md:col-span-2">Reason (audited)
        <input value={reason} minLength={10} maxLength={500} onChange={event => setReason(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" />
      </label>
    </div>
    {details ? <div className="mt-5 overflow-x-auto rounded-xl border">
      <div className="border-b bg-slate-50 p-4 text-sm dark:bg-slate-900">
        <strong>{details.name}</strong> · Plan: {details.planCode} · Base enforcement: {details.enforcementEnabled ? "On" : "Legacy off"}
      </div>
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead><tr className="border-b"><th className="p-3">Module</th><th className="p-3">Base plan</th><th className="p-3">Effective access</th><th className="p-3">Override expiry</th><th className="p-3">Platform action</th></tr></thead>
        <tbody>{details.features.map(feature => <tr key={feature.key} className="border-b">
          <td className="p-3"><strong>{feature.name}</strong><span className="block text-xs text-slate-500">{feature.group}</span></td>
          <td className="p-3">{feature.includedInPlan ? "Included" : "Not purchased"}</td>
          <td className="p-3">{feature.enabled ? "Enabled" : "Disabled"} <span className="text-xs text-slate-500">({feature.source.toLowerCase()})</span></td>
          <td className="p-3">{feature.override?.expiresAt ? new Date(feature.override.expiresAt).toLocaleDateString("en-IN") : "—"}</td>
          <td className="p-3"><div className="flex flex-wrap gap-2">
            {feature.enabled
              ? <button disabled={!!busy} onClick={() => void changeFeature(feature, false)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Disable</button>
              : <button disabled={!!busy} onClick={() => void changeFeature(feature, true)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">{feature.includedInPlan ? "Enable" : "Trial"}</button>}
            {feature.override && <button disabled={!!busy} onClick={() => void changeFeature(feature, null)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Reset</button>}
          </div></td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="mt-6 text-sm text-slate-500">Select a client to inspect licensed modules.</p>}
    <p className="mt-4 text-sm text-slate-500">Disabling a feature restricts server-side access without deleting client records. Paid upgrades must be processed through the existing subscription/billing controls. Core modules and AI/video quota metering require separate enforcement work.</p>
  </ProtectedAdminWorkspace>;
}
