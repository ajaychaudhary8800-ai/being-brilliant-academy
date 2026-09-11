"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, CalendarDays, Download, FileText, Mail, MessageCircle, Paperclip, Plus, Search, Send } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { activeAdminOptionUrls } from "../../../components/admin-option-queries";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";
import { communicationFields, type CommunicationRow } from "../../../components/communication-display";
import type { InstitutionRegionalSettings } from "../../../components/institution-time";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const tabs = ["announcements", "notifications", "messages", "circulars", "events"] as const;
type Tab = typeof tabs[number];
type Option = { id: string; name?: string; title?: string; branchName?: string; branchId?: string };
type FormState = { title: string; body: string; number: string; audience: string; branchId: string; batchId: string; scheduledAt: string; expiresAt: string; requiresAcknowledgement: boolean; file: File | null };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
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
  const [branches, setBranches] = useState<Option[]>([]);
  const [batches, setBatches] = useState<Option[]>([]);
  const [form, setForm] = useState<FormState>({ title: "", body: "", number: "", audience: "", branchId: "", batchId: "", scheduledAt: "", expiresAt: "", requiresAcknowledgement: true, file: null });

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
  useEffect(() => {
    const options = activeAdminOptionUrls(API);
    void Promise.all([request(options.branches), request(options.batches)]).then(([branchResult, batchResult]) => {
      setBranches(branchResult.data ?? []);
      setBatches(batchResult.data ?? []);
    }).catch((cause) => setError(errorMessage(cause)));
  }, []);

  async function filePayload(file: File | null) {
    if (!file) return {};
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Unable to read attachment")); reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? ""); reader.readAsDataURL(file); });
    return { name: file.name, mimeType: file.type, base64 };
  }

  async function create() {
    try {
      const file = await filePayload(form.file);
      const target = { branchId: form.branchId || null, audience: form.audience || null, ...(tab === "circulars" ? { publishedAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null } : { batchId: form.batchId || null, scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null }), expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null, ...file };
      if (tab === "announcements") await request("/communication/announcements", { method: "POST", body: JSON.stringify({ title: form.title, body: form.body, priority: "NORMAL", ...target }) });
      else if (tab === "events") await request("/communication/events", { method: "POST", body: JSON.stringify({ title: form.title, description: form.body, type: "SCHOOL", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() }) });
      else if (tab === "circulars") await request("/communication/circulars", { method: "POST", body: JSON.stringify({ number: form.number || `CIR-${Date.now()}`, title: form.title, body: form.body, requiresAcknowledgement: form.requiresAcknowledgement, ...target }) });
      setShow(false);
      setForm({ title: "", body: "", number: "", audience: "", branchId: "", batchId: "", scheduledAt: "", expiresAt: "", requiresAcknowledgement: true, file: null });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function download(row: CommunicationRow) {
    const path = tab === "announcements" ? `/communication/announcements/${row.id}/attachment` : `/communication/circulars/${row.id}/attachment`;
    const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } });
    if (!response.ok) throw new Error("Attachment is unavailable");
    const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a"); anchor.href = url; anchor.download = row.attachmentName ?? "communication-attachment"; anchor.click(); URL.revokeObjectURL(url);
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
      <input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} className="w-full rounded-lg border p-3 dark:bg-slate-900" placeholder="Title"/>
      {tab === "circulars" && <input value={form.number} onChange={event => setForm({ ...form, number: event.target.value })} className="w-full rounded-lg border p-3 dark:bg-slate-900" placeholder="Circular number (optional)"/>}
      <textarea value={form.body} onChange={event => setForm({ ...form, body: event.target.value })} className="min-h-32 w-full rounded-lg border p-3 dark:bg-slate-900" placeholder="Content"/>
      <div className="grid gap-3 sm:grid-cols-2"><select value={form.audience} onChange={event => setForm({ ...form, audience: event.target.value })} className="rounded-lg border p-3"><option value="">All audiences</option>{["STUDENT", "PARENT", "TEACHER", "EMPLOYEE"].map(value => <option key={value}>{value}</option>)}</select><select value={form.branchId} onChange={event => setForm({ ...form, branchId: event.target.value, batchId: "" })} className="rounded-lg border p-3"><option value="">All branches</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.branchName ?? branch.name ?? branch.title}</option>)}</select>{tab !== "circulars" && <select value={form.batchId} onChange={event => setForm({ ...form, batchId: event.target.value })} className="rounded-lg border p-3"><option value="">All batches</option>{batches.filter(batch => !form.branchId || batch.branchId === form.branchId).map(batch => <option key={batch.id} value={batch.id}>{batch.name ?? batch.title}</option>)}</select>}<label className="text-sm font-semibold">Publish at (optional)<input type="datetime-local" value={form.scheduledAt} onChange={event => setForm({ ...form, scheduledAt: event.target.value })} className="mt-1 w-full rounded-lg border p-3 font-normal"/></label><label className="text-sm font-semibold">Expires at (optional)<input type="datetime-local" value={form.expiresAt} onChange={event => setForm({ ...form, expiresAt: event.target.value })} className="mt-1 w-full rounded-lg border p-3 font-normal"/></label></div>
      {tab === "circulars" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requiresAcknowledgement} onChange={event => setForm({ ...form, requiresAcknowledgement: event.target.checked })}/>Require acknowledgement</label>}
      <label className="flex items-center gap-2 rounded-lg border p-3 text-sm"><Paperclip size={16}/><span className="flex-1">Optional PDF or image attachment</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => setForm({ ...form, file: event.target.files?.[0] ?? null })}/></label>
      <div className="flex gap-2"><button disabled={!form.title.trim() || !form.body.trim()} onClick={() => void create()} className="flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-white disabled:opacity-50"><Send size={16}/>Save</button><button onClick={() => setShow(false)} className="rounded-lg border px-4">Cancel</button></div>
    </div>}
    <div className="card divide-y dark:divide-slate-800">
      {rows.map((row, index) => <div className="grid gap-3 p-4 text-sm sm:grid-cols-2 xl:grid-cols-6" key={String(row.id ?? index)}>{communicationFields(tab, row, settings).map(field => <span key={field.label}><small className="block uppercase text-slate-400">{field.label}</small>{field.value}</span>)}{(tab === "announcements" || tab === "circulars") && row.attachmentName && <button className="inline-flex items-center gap-1 text-brand-700" onClick={() => void download(row).catch(cause => setError(errorMessage(cause)))}><Download size={15}/>Attachment</button>}</div>)}
      {!rows.length && <p className="p-6 text-slate-500">No records found.</p>}
    </div>
    <p className="mt-4 text-xs text-slate-500">Audience targeting, scheduling, expiry, attachments, read receipts, group messaging, delivery queues, preferences, circular versions, acknowledgements, download tracking, RSVP, audit logs and automatic module events are available through the authenticated APIs.</p>
  </ProtectedAdminWorkspace>;
}
