"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCircle2, ExternalLink, Search } from "lucide-react";
import { errorMessage, getAccessToken } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type AlertRow = {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  sourceModule: string;
  sourceEntityId?: string | null;
  actionUrl?: string | null;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
};

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "Unable to load analytics alerts");
  return body;
}

export function AnalyticsActionCenter() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [severity, setSeverity] = useState("");
  const [search, setSearch] = useState("");
  const [includeResolved, setIncludeResolved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: "1", limit: "20" });
      if (severity) params.set("severity", severity);
      if (search.trim()) params.set("search", search.trim());
      if (!includeResolved) params.set("open", "true");
      const response = await request(`/analytics/alerts?${params.toString()}`);
      setAlerts(response.data ?? []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [severity, search, includeResolved]);

  useEffect(() => { void load(); }, [load]);

  async function update(alert: AlertRow, action: "acknowledged" | "resolved") {
    setWorkingId(alert.id);
    setError("");
    try {
      await request(`/analytics/alerts/${alert.id}`, { method: "PATCH", body: JSON.stringify({ [action]: true }) });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorkingId("");
    }
  }

  return <section className="mt-6 card p-5" aria-label="Analytics action center">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><BellRing size={18} className="text-brand-700" /><h2 className="font-semibold">Action center</h2></div>
        <p className="mt-1 text-sm text-slate-500">Review analytics alerts, acknowledge ownership, resolve completed items, and open the relevant ERP record.</p>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeResolved} onChange={event => setIncludeResolved(event.target.checked)} />Include resolved</label>
    </div>

    <div className="mt-4 flex flex-wrap gap-2">
      <label className="relative min-w-64 flex-1"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input className="field w-full pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search alerts" /></label>
      <select className="field" value={severity} onChange={event => setSeverity(event.target.value)} aria-label="Alert severity">
        <option value="">All severities</option>
        <option value="HIGH">High</option>
        <option value="MEDIUM">Medium</option>
        <option value="LOW">Low</option>
      </select>
      <button disabled={loading} onClick={() => void load()} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Refresh</button>
    </div>

    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading && <p role="status" className="mt-4 text-sm text-slate-500">Loading alerts…</p>}

    <div className="mt-4 divide-y dark:divide-slate-800">
      {!loading && alerts.length === 0 && <p className="py-4 text-sm text-slate-500">No alerts match this view.</p>}
      {alerts.map(alert => <article key={alert.id} className="py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <b>{alert.title}</b>
              <span className="rounded-full border px-2 py-0.5 text-xs">{alert.severity}</span>
              {alert.acknowledgedAt && <span className="text-xs text-slate-500">Acknowledged</span>}
              {alert.resolvedAt && <span className="text-xs text-slate-500">Resolved</span>}
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{alert.body}</p>
            <p className="mt-1 text-xs text-slate-500">{alert.sourceModule} · {new Date(alert.createdAt).toLocaleString()}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!alert.acknowledgedAt && !alert.resolvedAt && <button disabled={workingId === alert.id} onClick={() => void update(alert, "acknowledged")} className="rounded-lg border px-2 py-1 text-sm disabled:opacity-50">Acknowledge</button>}
            {!alert.resolvedAt && <button disabled={workingId === alert.id} onClick={() => void update(alert, "resolved")} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-sm disabled:opacity-50"><CheckCircle2 size={14} />Resolve</button>}
            {alert.actionUrl && <a href={alert.actionUrl} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-sm"><ExternalLink size={14} />Open</a>}
          </div>
        </div>
      </article>)}
    </div>
  </section>;
}
