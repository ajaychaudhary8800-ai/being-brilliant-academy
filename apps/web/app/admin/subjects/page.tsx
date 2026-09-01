"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Edit3, GitMerge, Plus, Search, Trash2, X } from "lucide-react";
import { AuthGate, getAccessToken, useAuth } from "../../../components/auth-provider";
import Sidebar from "../../../components/sidebar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Subject = { id: string; name: string; code: string; description: string | null; status: "ACTIVE" | "INACTIVE"; legacyReviewStatus: "CONFIRMED" | "REVIEW_REQUIRED"; _count: Record<string, number> };
type SubjectForm = Pick<Subject, "name" | "code" | "status" | "legacyReviewStatus"> & { description: string };
type DependencyCounts = Record<string, number>;
type MergePreview = {
  canMerge: boolean;
  dependencies: DependencyCounts;
  duplicateCourseIds: string[];
  duplicateTeacherIds: string[];
  unmatchedCourseIds: string[];
  unmatchedTeacherIds: string[];
  blockingDependencies: Array<{ key: string; label: string; count: number }>;
};
const blank: SubjectForm = { name: "", code: "", description: "", status: "ACTIVE", legacyReviewStatus: "CONFIRMED" };
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });
async function json(response: Response) { const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error?.message ?? "Request failed"); return body; }

function Content() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Subject[]>([]);
  const [search, setSearch] = useState(""), [status, setStatus] = useState(""), [review, setReview] = useState(""), [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 }), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [modalError, setModalError] = useState(""), [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"add" | "edit" | "delete" | "merge" | null>(null), [selected, setSelected] = useState<Subject | null>(null), [form, setForm] = useState<SubjectForm>(blank);
  const [dependencies, setDependencies] = useState<DependencyCounts | null>(null), [replacementId, setReplacementId] = useState(""), [replacements, setReplacements] = useState<Subject[]>([]), [mergePreview, setMergePreview] = useState<MergePreview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20", search });
      if (status) params.set("status", status); if (review) params.set("reviewStatus", review);
      const result = await fetch(`${API}/admin/subjects?${params}`, { headers: headers() }).then(json);
      setRows(result.data); setMeta(result.meta); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load subjects"); }
    finally { setLoading(false); }
  }, [page, search, status, review]);
  useEffect(() => { void load(); }, [load]);

  const close = () => { setMode(null); setSelected(null); setModalError(""); setDependencies(null); setReplacementId(""); setReplacements([]); setMergePreview(null); };
  const open = async (next: "add" | "edit" | "delete" | "merge", subject?: Subject) => {
    setMode(next); setSelected(subject ?? null); setModalError(""); setDependencies(null); setReplacementId(""); setMergePreview(null);
    setForm(subject ? { name: subject.name, code: subject.code, description: subject.description ?? "", status: subject.status, legacyReviewStatus: subject.legacyReviewStatus } : blank);
    try {
      if (next === "delete" && subject) {
        const result = await fetch(`${API}/admin/subjects/${subject.id}/dependencies`, { headers: headers() }).then(json);
        setDependencies(result.data.dependencies);
      }
      if (next === "merge" && subject) {
        const result = await fetch(`${API}/admin/subjects/options`, { headers: headers() }).then(json);
        setReplacements((result.data ?? []).filter((item: Subject) => item.id !== subject.id));
      }
    } catch (cause) { setModalError(cause instanceof Error ? cause.message : "Unable to prepare this action"); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setModalError("");
    try {
      await fetch(mode === "add" ? `${API}/admin/subjects` : `${API}/admin/subjects/${selected!.id}`, { method: mode === "add" ? "POST" : "PATCH", headers: headers(), body: JSON.stringify({ ...form, description: form.description || null }) }).then(json);
      close(); setNotice(mode === "add" ? "Subject created." : "Subject updated."); await load();
    } catch (cause) { setModalError(cause instanceof Error ? cause.message : "Unable to save subject"); }
    finally { setSaving(false); }
  };
  const toggle = async (subject: Subject) => { try { await fetch(`${API}/admin/subjects/${subject.id}/status`, { method: "PATCH", headers: headers(), body: JSON.stringify({ status: subject.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }) }).then(json); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to change subject status"); } };
  const remove = async () => {
    if (!selected) return; setSaving(true); setModalError("");
    try { const response = await fetch(`${API}/admin/subjects/${selected.id}`, { method: "DELETE", headers: headers() }); if (!response.ok) await json(response); close(); setNotice("Subject deleted."); await load(); }
    catch (cause) { setModalError(cause instanceof Error ? cause.message : "Unable to delete subject"); }
    finally { setSaving(false); }
  };
  const previewMerge = async () => {
    if (!selected || !replacementId) return; setSaving(true); setModalError(""); setMergePreview(null);
    try { const result = await fetch(`${API}/admin/subjects/${selected.id}/merge-preview?${new URLSearchParams({ replacementSubjectId: replacementId })}`, { headers: headers() }).then(json); setMergePreview(result.data); }
    catch (cause) { setModalError(cause instanceof Error ? cause.message : "Unable to preview cleanup"); }
    finally { setSaving(false); }
  };
  const merge = async () => {
    if (!selected || !replacementId || !mergePreview?.canMerge) return; setSaving(true); setModalError("");
    try { const result = await fetch(`${API}/admin/subjects/${selected.id}/merge`, { method: "POST", headers: headers(), body: JSON.stringify({ replacementSubjectId: replacementId }) }).then(json); close(); setNotice(`Legacy mappings cleaned: ${result.data.removedCourseMappings} course and ${result.data.removedTeacherMappings} teacher mappings removed. The legacy subject is now inactive.`); await load(); }
    catch (cause) { setModalError(cause instanceof Error ? cause.message : "Unable to clean up subject mappings"); }
    finally { setSaving(false); }
  };
  const usedDependencies = dependencies ? Object.entries(dependencies).filter(([, count]) => count > 0) : [];

  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><Sidebar/><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-7xl">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-bold text-brand-700">ACADEMICS</p><h1 className="text-3xl font-bold">Subject Master</h1><p className="text-sm text-slate-500">Tenant-scoped subjects shared by teachers, allocations, timetables, homework and exams.</p></div><button className="btn bg-brand-700 text-white" onClick={() => void open("add")}><Plus size={17}/>Add Subject</button></header>
    {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    <section className="mt-5 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-3"><label className="relative"><Search className="absolute left-3 top-3" size={17}/><input className="field pl-10" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, code or description"/></label><select className="field" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option>ACTIVE</option><option>INACTIVE</option></select><select className="field" value={review} onChange={event => { setReview(event.target.value); setPage(1); }}><option value="">All review states</option><option value="CONFIRMED">Confirmed</option><option value="REVIEW_REQUIRED">Legacy review required</option></select></section>
    <section className="mt-5 overflow-hidden rounded-2xl border bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50"><tr>{["Subject", "Description", "Courses", "Teachers", "Academic references", "Review", "Status", "Actions"].map(label => <th className="p-4" key={label}>{label}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={8} className="p-16 text-center">Loading…</td></tr> : rows.length ? rows.map(row => <tr className="border-t" key={row.id}><td className="p-4"><b>{row.name}</b><br/><span className="text-slate-500">{row.code}</span></td><td>{row.description ?? "—"}</td><td>{row._count.courses}</td><td>{row._count.teachers}</td><td>{row._count.teacherAllocations + row._count.timetables + row._count.homeworks + row._count.examinations}</td><td>{row.legacyReviewStatus === "REVIEW_REQUIRED" ? <span className="text-amber-700">Review required</span> : "Confirmed"}</td><td><button onClick={() => void toggle(row)} className={row.status === "ACTIVE" ? "text-emerald-700" : "text-slate-500"}>{row.status}</button></td><td><button className="icon" aria-label="Edit" onClick={() => void open("edit", row)}><Edit3 size={16}/></button>{user?.role === "SUPER_ADMIN" && row.legacyReviewStatus === "REVIEW_REQUIRED" && <button className="icon text-amber-700" aria-label="Clean up legacy subject" title="Clean up redundant legacy mappings" onClick={() => void open("merge", row)}><GitMerge size={16}/></button>}{row.status === "INACTIVE" && <button className="icon text-red-600" aria-label="Delete" onClick={() => void open("delete", row)}><Trash2 size={16}/></button>}</td></tr>) : <tr><td colSpan={8} className="p-16 text-center"><BookOpen className="mx-auto mb-2 text-slate-300"/>No subjects found.</td></tr>}</tbody></table></div><footer className="flex items-center justify-between border-t p-4"><span>{meta.total} subjects</span><div className="flex items-center gap-3"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft/></button>{page}/{meta.totalPages}<button disabled={page >= meta.totalPages} onClick={() => setPage(value => value + 1)}><ChevronRight/></button></div></footer></section>
  </div></main>{mode && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/60 p-4"><div className="my-8 w-full max-w-xl rounded-2xl bg-white p-6 dark:bg-slate-900"><div className="flex justify-between"><h2 className="text-xl font-bold">{mode === "add" ? "Add Subject" : mode === "edit" ? "Edit Subject" : mode === "merge" ? "Clean Up Legacy Subject" : "Safe Delete"}</h2><button onClick={close}><X/></button></div>
    {mode === "delete" ? <div><p className="mt-6">Delete this inactive subject only when every academic and learning dependency is zero.</p>{dependencies ? usedDependencies.length ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><b>Deletion is currently blocked:</b> {usedDependencies.map(([key, count]) => `${count} ${key}`).join(", ")}.</div> : <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">No subject dependencies were found.</p> : <p className="mt-4 text-sm text-slate-500">Loading dependency preview…</p>}<button disabled={saving || !dependencies || usedDependencies.length > 0} className="btn mt-6 bg-red-600 text-white" onClick={() => void remove()}>Delete safely</button></div>
    : mode === "merge" ? <div className="mt-5 space-y-4"><p className="text-sm text-slate-600">This workflow never rewrites teacher-allocation snapshots or academic history. It only removes source course/teacher mappings that already exist for the chosen replacement, then deactivates the legacy subject.</p><label className="block text-sm font-semibold">Replacement subject<select className="field mt-1.5" value={replacementId} onChange={event => { setReplacementId(event.target.value); setMergePreview(null); }}><option value="">Select an active confirmed subject</option>{replacements.map(subject => <option value={subject.id} key={subject.id}>{subject.name} ({subject.code})</option>)}</select></label><button disabled={saving || !replacementId} className="btn" onClick={() => void previewMerge()}>Preview dependencies</button>{mergePreview && <div className={`rounded-xl border p-4 text-sm ${mergePreview.canMerge ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}><b>{mergePreview.canMerge ? "Safe relationship cleanup available" : "Cleanup blocked"}</b><p className="mt-2">Redundant mappings: {mergePreview.duplicateCourseIds.length} course, {mergePreview.duplicateTeacherIds.length} teacher.</p>{mergePreview.blockingDependencies.length > 0 && <p>Historical/operational references: {mergePreview.blockingDependencies.map(item => `${item.count} ${item.label}`).join(", ")}.</p>}{mergePreview.unmatchedCourseIds.length > 0 && <p>{mergePreview.unmatchedCourseIds.length} course mappings do not yet use the replacement.</p>}{mergePreview.unmatchedTeacherIds.length > 0 && <p>{mergePreview.unmatchedTeacherIds.length} teacher mappings do not yet use the replacement.</p>}</div>}<button disabled={saving || !mergePreview?.canMerge} className="btn bg-amber-700 text-white" onClick={() => void merge()}>Confirm cleanup and deactivate legacy subject</button></div>
    : <form onSubmit={save} className="mt-5 grid gap-4"><label>Name<input required minLength={2} maxLength={120} className="field" value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))}/></label><label>Code<input required pattern="[A-Za-z0-9-]+" className="field" value={form.code} onChange={event => setForm(value => ({ ...value, code: event.target.value.toUpperCase() }))}/></label><label>Description<textarea rows={3} maxLength={2000} className="field" value={form.description} onChange={event => setForm(value => ({ ...value, description: event.target.value }))}/></label>{mode === "edit" && selected?.legacyReviewStatus === "REVIEW_REQUIRED" && <label className="rounded-xl border border-amber-200 bg-amber-50 p-3"><input type="checkbox" checked={form.legacyReviewStatus === "CONFIRMED"} onChange={event => setForm(value => ({ ...value, legacyReviewStatus: event.target.checked ? "CONFIRMED" : "REVIEW_REQUIRED" }))}/> I reviewed this legacy subject name and confirm it represents one academic subject.</label>}<button disabled={saving} className="btn bg-brand-700 text-white"><CheckCircle2 size={17}/>{saving ? "Saving…" : "Save Subject"}</button></form>}
    {modalError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{modalError}</p>}
  </div></div>}</div>;
}

export default function Page() { return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><Content/></AuthGate>; }
