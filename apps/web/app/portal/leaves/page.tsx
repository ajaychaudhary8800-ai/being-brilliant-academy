"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import { CalendarDays, Download, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { AuthGate, getAccessToken } from "../../../components/auth-provider";
import { documentAsBase64, validateDocumentFile } from "../../../components/document-upload";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });
type Attachment = { name: string; mimeType: "application/pdf" | "image/jpeg" | "image/png"; base64: string };
type Form = { fromDate: string; toDate: string; reason: string; leaveType: string; halfDaySession: string; attachment: Attachment | null };
type Leave = { id: string; fromDate: string; toDate: string; reason: string; leaveType: string; halfDaySession: string | null; status: string; remarks: string | null; attachmentName: string | null; approvedAt: string | null; createdAt: string };
const empty: Form = { fromDate: "", toDate: "", reason: "", leaveType: "FULL_DAY", halfDaySession: "", attachment: null };
async function json(response: Response) { const body = await response.json().catch(() => null); if (!response.ok) throw Error(body?.error?.message ?? "Request failed"); return body; }
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());

function Content() {
  const [rows, setRows] = useState<Leave[]>([]), [form, setForm] = useState<Form>(empty), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => { setLoading(true); try { setRows((await fetch(`${API}/portal/leaves`, { headers: headers() }).then(json)).data); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Load failed"); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function chooseAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const invalid = validateDocumentFile(file, "leave-attachment"); if (invalid) return setError(invalid);
    const base64 = await documentAsBase64(file);
    setError(""); setForm(current => ({ ...current, attachment: { name: file.name, mimeType: file.type as Attachment["mimeType"], base64 } }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await fetch(`${API}/portal/leaves`, { method: "POST", headers: headers(), body: JSON.stringify({ ...form, halfDaySession: form.halfDaySession || null }) }).then(json); setForm(empty); setNotice("Leave request submitted"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Submit failed"); } finally { setSaving(false); }
  }
  async function cancel(leaveId: string) { if (!window.confirm("Cancel this pending leave request?")) return; try { await fetch(`${API}/portal/leaves/${leaveId}`, { method: "DELETE", headers: headers() }).then(json); setNotice("Leave request cancelled"); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Cancel failed"); } }
  async function download(leave: Leave) { const response = await fetch(`${API}/portal/leaves/${leave.id}/attachment`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } }); if (!response.ok) return setError("Unable to download attachment"); const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a"); anchor.href = url; anchor.download = leave.attachmentName ?? "leave-attachment"; anchor.click(); URL.revokeObjectURL(url); }
  const oneDay = form.leaveType === "HALF_DAY" || form.leaveType === "SHORT_LEAVE";

  return <main className="min-h-screen bg-slate-50 p-5 md:p-10"><div className="mx-auto max-w-5xl"><h1 className="text-3xl font-bold">My Leave Requests</h1><p className="text-slate-500">Apply for full-day, half-day or short leave and track decisions.</p>{notice && <p role="status" className="mt-4 rounded bg-emerald-50 p-3 text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-red-700">{error}</p>}
    <form onSubmit={submit} className="mt-6 grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2"><label>Leave type<select className="field" value={form.leaveType} onChange={event => setForm(current => ({ ...current, leaveType: event.target.value, halfDaySession: event.target.value === "HALF_DAY" ? current.halfDaySession : "", ...(event.target.value !== "FULL_DAY" && current.fromDate ? { toDate: current.fromDate } : {}) }))}><option value="FULL_DAY">Full-Day Leave</option><option value="HALF_DAY">Half-Day Leave</option><option value="SHORT_LEAVE">Short Leave</option></select></label>{form.leaveType === "HALF_DAY" && <label>Half-day session<select required className="field" value={form.halfDaySession} onChange={event => setForm(current => ({ ...current, halfDaySession: event.target.value }))}><option value="">Select</option><option value="FIRST_HALF">First Half</option><option value="SECOND_HALF">Second Half</option></select></label>}<label>From<input required type="date" className="field" value={form.fromDate} onChange={event => setForm(current => ({ ...current, fromDate: event.target.value, ...(oneDay ? { toDate: event.target.value } : {}) }))}/></label><label>To<input required type="date" min={form.fromDate || undefined} className="field" disabled={oneDay} value={form.toDate} onChange={event => setForm(current => ({ ...current, toDate: event.target.value }))}/></label><label className="sm:col-span-2">Reason<textarea required minLength={3} maxLength={2000} className="field" value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))}/></label><div className="sm:col-span-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 font-semibold"><Upload size={17}/>Attach document<input className="hidden" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={chooseAttachment}/></label>{form.attachment && <span className="ml-3 inline-flex items-center gap-2 text-sm"><Paperclip size={15}/>{form.attachment.name}<button type="button" aria-label="Remove attachment" onClick={() => setForm(current => ({ ...current, attachment: null }))}><Trash2 size={15}/></button></span>}<p className="mt-1 text-xs text-slate-500">Optional PDF, JPG, JPEG or PNG; maximum 5 MB.</p></div><button disabled={saving} className="rounded-xl bg-brand-700 p-3 font-bold text-white sm:col-span-2">{saving ? "Submitting…" : "Apply for Leave"}</button></form>
    <section className="mt-6 space-y-3">{loading ? <Loader2 className="animate-spin"/> : rows.length ? rows.map(leave => <article key={leave.id} className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><b>{label(leave.leaveType)}</b><p className="text-sm">{leave.fromDate.slice(0, 10)} — {leave.toDate.slice(0, 10)} {leave.halfDaySession ? `· ${label(leave.halfDaySession)}` : ""}</p></div><span className={`rounded-full px-3 py-1 text-sm font-bold ${leave.status === "APPROVED" ? "bg-emerald-100 text-emerald-800" : leave.status === "REJECTED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{label(leave.status)}</span></div><p className="mt-3">{leave.reason}</p>{leave.remarks && <p className="mt-2 text-sm text-slate-500">Review remarks: {leave.remarks}</p>}<div className="mt-3 flex gap-4">{leave.attachmentName && <button className="inline-flex items-center gap-1 text-sm font-bold text-brand-700" onClick={() => void download(leave)}><Download size={15}/>{leave.attachmentName}</button>}{leave.status === "PENDING" && <button className="text-sm font-bold text-red-600" onClick={() => void cancel(leave.id)}>Cancel request</button>}</div></article>) : <div className="py-12 text-center text-slate-500"><CalendarDays className="mx-auto"/>No leave requests yet.</div>}</section>
  </div><style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem}`}</style></main>;
}

export default function Page() { return <AuthGate roles={["STUDENT", "TEACHER"]}><Content/></AuthGate>; }
