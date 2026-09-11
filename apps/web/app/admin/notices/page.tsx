"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Archive, Download, Edit3, Loader2, Paperclip, Plus, Search, X } from "lucide-react";
import { AuthGate, getAccessToken } from "../../../components/auth-provider";
import { activeAdminOptionUrls } from "../../../components/admin-option-queries";
import { formatInstitutionDateTime, institutionDateTimeInput, type InstitutionRegionalSettings } from "../../../components/institution-time";
import Sidebar from "../../../components/sidebar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });
const blank = { title: "", body: "", category: "GENERAL", priority: "NORMAL", audience: "", branchId: "", batchId: "", publishedAt: "", expiresAt: "", isPinned: false, requiresAcknowledgement: false, file: null as File | null };
type NoticeForm = typeof blank;
type Notice = { id: string; title: string; body: string; category: string | null; priority: string; audience: string | null; isPinned: boolean; requiresAcknowledgement: boolean; publishedAt: string; expiresAt: string | null; attachmentName: string | null; branch: { id?: string; branchName: string } | null; batch: { id?: string; name: string } | null; author: { name: string }; _count: { reads: number } };
type Option = { id: string; branchName?: string; name?: string; title?: string; branchId?: string };

async function json(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Error(body?.error?.message ?? "Request failed");
  return body;
}

function Content() {
  const [rows, setRows] = useState<Notice[]>([]);
  const [form, setForm] = useState<NoticeForm>(blank);
  const [settings, setSettings] = useState<InstitutionRegionalSettings>({});
  const [branches, setBranches] = useState<Option[]>([]), [batches, setBatches] = useState<Option[]>([]);
  const [show, setShow] = useState(false), [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [notices, organization] = await Promise.all([
        fetch(`${API}/notices?limit=100&search=${encodeURIComponent(search)}`, { headers: headers() }).then(json),
        fetch(`${API}/organization/settings`, { headers: headers() }).then(json),
      ]);
      setRows(notices.data);
      setSettings({ timeZone: organization.data.timezone, locale: organization.data.locale });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const options = activeAdminOptionUrls(API); void Promise.all([fetch(options.branches, { headers: headers() }).then(json), fetch(options.batches, { headers: headers() }).then(json)]).then(([branchResult, batchResult]) => { setBranches(branchResult.data ?? []); setBatches(batchResult.data ?? []); }).catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load notice options")); }, []);

  function openCreate() {
    setForm({ ...blank, publishedAt: institutionDateTimeInput(new Date(), settings.timeZone) });
    setEditingId(null);
    setShow(true);
  }

  function openEdit(item: Notice) {
    setEditingId(item.id);
    setForm({ ...blank, title: item.title, body: item.body, category: item.category ?? "GENERAL", priority: item.priority, audience: item.audience ?? "", branchId: item.branch?.id ?? "", batchId: item.batch?.id ?? "", publishedAt: institutionDateTimeInput(item.publishedAt, settings.timeZone), expiresAt: item.expiresAt ? institutionDateTimeInput(item.expiresAt, settings.timeZone) : "", isPinned: item.isPinned, requiresAcknowledgement: item.requiresAcknowledgement });
    setShow(true);
  }

  async function filePayload(file: File | null) {
    if (!file) return {};
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Unable to read attachment")); reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? ""); reader.readAsDataURL(file); });
    return { attachment: { name: file.name, mimeType: file.type, base64 } };
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const { file, ...fields } = form, payload = { ...fields, audience: form.audience || null, branchId: form.branchId || null, batchId: form.batchId || null, publishedAt: form.publishedAt || undefined, expiresAt: form.expiresAt || null, ...(await filePayload(file)) };
      await fetch(editingId ? `${API}/admin/notices/${editingId}` : `${API}/admin/notices`, { method: editingId ? "PATCH" : "POST", headers: headers(), body: JSON.stringify(payload) }).then(json);
      setForm(blank);
      setEditingId(null);
      setShow(false);
      setNotice("Notice published");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publish failed");
    }
  }

  async function download(item: Notice) {
    const response = await fetch(`${API}/notices/${item.id}/attachment`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } });
    if (!response.ok) throw Error("Attachment is unavailable");
    const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a"); anchor.href = url; anchor.download = item.attachmentName ?? "notice-attachment"; anchor.click(); URL.revokeObjectURL(url);
  }

  async function archive(id: string) {
    const response = await fetch(`${API}/admin/notices/${id}`, { method: "DELETE", headers: headers() });
    if (!response.ok) return setError((await response.json()).error?.message);
    setNotice("Notice archived");
    await load();
  }

  return <div className="min-h-screen bg-slate-50"><Sidebar/><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-6xl">
    <header className="flex justify-between"><div><h1 className="text-3xl font-bold">Notice Board</h1><p className="text-slate-500">Targeted, pinned and acknowledgement-aware notices.</p></div><button className="btn bg-brand-700 text-white" onClick={openCreate}><Plus/>New Notice</button></header>
    {notice && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-emerald-700">{notice}</p>}
    {error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-red-700">{error}</p>}
    <label className="relative mt-5 block"><Search className="absolute left-3 top-3" size={16}/><input className="field pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search notices"/></label>
    <section className="mt-5 space-y-3">{loading ? <Loader2 className="mx-auto animate-spin"/> : rows.map(item => <article key={item.id} className="rounded-2xl border bg-white p-5"><div className="flex justify-between"><div><span className="text-xs font-bold text-brand-700">{item.isPinned ? "PINNED · " : ""}{item.category} · {item.priority}</span><h2 className="text-xl font-bold">{item.title}</h2></div><div className="flex gap-2"><button aria-label={`Edit ${item.title}`} onClick={() => openEdit(item)}><Edit3/></button><button aria-label={`Archive ${item.title}`} onClick={() => void archive(item.id)}><Archive/></button></div></div><p className="mt-2 whitespace-pre-wrap">{item.body}</p><p className="mt-3 text-xs text-slate-500">{item.branch?.branchName ?? "All branches"} · {item.batch?.name ?? "All batches"} · By {item.author.name}</p><p className="mt-1 text-xs text-slate-500">Published {formatInstitutionDateTime(item.publishedAt, settings)}{item.expiresAt ? ` · Expires ${formatInstitutionDateTime(item.expiresAt, settings)}` : ""} · {item._count.reads} read/acknowledged{item.requiresAcknowledgement ? " · acknowledgement required" : ""}</p>{item.attachmentName && <button className="mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void download(item).catch(cause => setError(cause instanceof Error ? cause.message : "Download failed"))}><Download size={15}/>{item.attachmentName}</button>}</article>)}</section>
  </div></main>
  {show && <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"><form onSubmit={save} className="grid w-full max-w-2xl gap-3 rounded-2xl bg-white p-6 sm:grid-cols-2"><button type="button" className="justify-self-end sm:col-span-2" onClick={() => { setShow(false); setEditingId(null); }}><X/></button><input required className="field sm:col-span-2" placeholder="Title" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })}/><textarea required className="field sm:col-span-2" placeholder="Notice content" value={form.body} onChange={event => setForm({ ...form, body: event.target.value })}/><input className="field" placeholder="Category" value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}/><select className="field" value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>{["LOW", "NORMAL", "HIGH", "URGENT"].map(value => <option key={value}>{value}</option>)}</select><select className="field" value={form.audience} onChange={event => setForm({ ...form, audience: event.target.value })}><option value="">Everyone</option>{["STUDENT", "PARENT", "TEACHER", "EMPLOYEE"].map(value => <option key={value}>{value}</option>)}</select><select className="field" value={form.branchId} onChange={event => setForm({ ...form, branchId: event.target.value, batchId: "" })}><option value="">All branches</option>{branches.map(item => <option key={item.id} value={item.id}>{item.branchName ?? item.name}</option>)}</select><select className="field" value={form.batchId} onChange={event => setForm({ ...form, batchId: event.target.value })}><option value="">All batches</option>{batches.filter(item => !form.branchId || item.branchId === form.branchId).map(item => <option key={item.id} value={item.id}>{item.name ?? item.title}</option>)}</select><label className="text-sm font-semibold">Publish at (institution time)<input required className="field mt-1" type="datetime-local" value={form.publishedAt} onChange={event => setForm({ ...form, publishedAt: event.target.value })}/></label><label className="text-sm font-semibold">Expires at (optional)<input className="field mt-1" type="datetime-local" value={form.expiresAt} onChange={event => setForm({ ...form, expiresAt: event.target.value })}/></label><label><input type="checkbox" checked={form.isPinned} onChange={event => setForm({ ...form, isPinned: event.target.checked })}/> Pinned</label><label><input type="checkbox" checked={form.requiresAcknowledgement} onChange={event => setForm({ ...form, requiresAcknowledgement: event.target.checked })}/> Require acknowledgement</label><label className="flex items-center gap-2 rounded-lg border p-3 text-sm sm:col-span-2"><Paperclip size={16}/><span className="flex-1">Optional PDF or image attachment</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => setForm({ ...form, file: event.target.files?.[0] ?? null })}/></label><button className="btn bg-brand-700 text-white sm:col-span-2">{editingId ? "Save Changes" : "Publish Notice"}</button></form></div>}
  <style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-weight:700}`}</style>
  </div>;
}

export default function Page() { return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><Content/></AuthGate>; }
