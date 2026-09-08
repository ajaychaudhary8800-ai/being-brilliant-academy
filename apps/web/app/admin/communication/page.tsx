"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CalendarDays, FileText, Mail, MessageCircle, Plus, Search, Send } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";
import { communicationFields, type CommunicationRow } from "../../../components/communication-display";
import type { InstitutionRegionalSettings } from "../../../components/institution-time";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const tabs = ["announcements", "notifications", "messages", "circulars", "events"] as const;
type Tab = typeof tabs[number];

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}`, ...init?.headers },
  });
  const json = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("announcements");
  const [rows, setRows] = useState<CommunicationRow[]>([]);
  const [dashboard, setDashboard] = useState<CommunicationRow>({});
  const [settings, setSettings] = useState<InstitutionRegionalSettings>({});
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const [dashboardResult, rowsResult, settingsResult] = await Promise.all([
        request("/communication/dashboard"),
        request(`/communication/${tab}?search=${encodeURIComponent(search)}&page=1&limit=50`),
        request("/organization/settings"),
      ]);
      setDashboard(dashboardResult.data);
      setRows(rowsResult.data);
      setSettings({ timeZone: settingsResult.data.timezone, locale: settingsResult.data.locale });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [tab, search]);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    try {
      if (tab === "announcements") await request("/communication/announcements", { method: "POST", body: JSON.stringify({ title, body, priority: "NORMAL" }) });
      else if (tab === "events") await request("/communication/events", { method: "POST", body: JSON.stringify({ title, description: body, type: "SCHOOL", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() }) });
      else if (tab === "circulars") await request("/communication/circulars", { method: "POST", body: JSON.stringify({ number: `CIR-${Date.now()}`, title, body, requiresAcknowledgement: true }) });
      setShow(false);
      setTitle("");
      setBody("");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  const cards = [[Bell, "Announcements", dashboard.announcements], [Mail, "Unread", dashboard.unread], [MessageCircle, "Messages", dashboard.messages], [FileText, "Circulars", dashboard.circulars], [CalendarDays, "Events", dashboard.events]];
  return <ProtectedAdminWorkspace title="Communication & Notifications" description="Announcements, multichannel notifications, messaging, circulars, events and automated module alerts.">
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([Icon, label, value]) => { const CardIcon = Icon as typeof Bell; return <div className="card p-4" key={String(label)}><CardIcon className="text-brand-700"/><p className="mt-3 text-xs uppercase text-slate-400">{String(label)}</p><b>{String(value ?? 0)}</b></div>; })}</div>
    <div className="mt-6 flex gap-2 overflow-x-auto">{tabs.map(name => <button key={name} onClick={() => setTab(name)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === name ? "bg-brand-700 text-white" : "border bg-white dark:bg-slate-900"}`}>{name}</button>)}</div>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    <div className="my-5 flex gap-3">
      <div className="relative flex-1"><Search className="absolute left-3 top-3" size={17}/><input value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border py-2.5 pl-9 dark:bg-slate-900" placeholder="Search communication records"/></div>
      {(["announcements", "circulars", "events"] as Tab[]).includes(tab) && <button onClick={() => setShow(true)} className="flex items-center gap-2 rounded-lg bg-brand-700 px-4 text-white"><Plus size={17}/>Create</button>}
    </div>
    {show && <div className="card mb-5 space-y-3 p-5">
      <input value={title} onChange={event => setTitle(event.target.value)} className="w-full rounded-lg border p-3 dark:bg-slate-900" placeholder="Title"/>
      <textarea value={body} onChange={event => setBody(event.target.value)} className="min-h-32 w-full rounded-lg border p-3 dark:bg-slate-900" placeholder="Content"/>
      <div className="flex gap-2"><button onClick={() => void create()} className="flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-white"><Send size={16}/>Save</button><button onClick={() => setShow(false)} className="rounded-lg border px-4">Cancel</button></div>
    </div>}
    <div className="card divide-y dark:divide-slate-800">
      {rows.map((row, index) => <div className="grid gap-3 p-4 text-sm sm:grid-cols-2 xl:grid-cols-5" key={String(row.id ?? index)}>{communicationFields(tab, row, settings).map(field => <span key={field.label}><small className="block uppercase text-slate-400">{field.label}</small>{field.value}</span>)}</div>)}
      {!rows.length && <p className="p-6 text-slate-500">No records found.</p>}
    </div>
    <p className="mt-4 text-xs text-slate-500">Audience targeting, scheduling, expiry, attachments, read receipts, group messaging, delivery queues, preferences, circular versions, acknowledgements, download tracking, RSVP, audit logs and automatic module events are available through the authenticated APIs.</p>
  </ProtectedAdminWorkspace>;
}
