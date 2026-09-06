"use client";
import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, Download, Edit3, Eye, FileDown, Loader2, NotebookPen, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { AuthGate, getAccessToken } from "../../../components/auth-provider";
import Sidebar from "../../../components/sidebar";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1", h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });
type Item = {
    id: string;
    title: string;
    description: string;
    type: string;
    assignedDate: string;
    dueDate: string;
    maximumMarks: number;
    status: string;
    remarks: string | null;
    attachmentName: string | null;
    attachmentSize: number | null;
    branch: any;
    course: any;
    batch: any;
    subject: any;
    teacher: any;
    timetable: any;
    submissions: any[];
    _count: {
        submissions: number;
    };
};
type Form = {
    title: string;
    description: string;
    branchId: string;
    courseId: string;
    batchId: string;
    subjectId: string;
    teacherId: string;
    timetableId: string;
    type: string;
    assignedDate: string;
    dueDate: string;
    maximumMarks: number;
    status: string;
    remarks: string;
    attachment: any;
};
const empty: Form = { title: "", description: "", branchId: "", courseId: "", batchId: "", subjectId: "", teacherId: "", timetableId: "", type: "HOMEWORK", assignedDate: new Date().toISOString().slice(0, 10), dueDate: "", maximumMarks: 100, status: "DRAFT", remarks: "", attachment: null };
function Content() {
    const [items, setItems] = useState<Item[]>([]), [options, setOptions] = useState<any>({ branches: [], batches: [], teachers: [], subjects: [], timetables: [], students: [] }), [stats, setStats] = useState<any>({}), [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1, limit: 20 }), [page, setPage] = useState(1), [search, setSearch] = useState(""), [branch, setBranch] = useState(""), [batch, setBatch] = useState(""), [status, setStatus] = useState(""), [type, setType] = useState(""), [due, setDue] = useState(""), [sort, setSort] = useState("dueDate:asc"), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState(""), [mode, setMode] = useState<"add" | "edit" | "view" | "delete" | null>(null), [selected, setSelected] = useState<Item | null>(null), [form, setForm] = useState<Form>(empty), [saving, setSaving] = useState(false), [evaluation, setEvaluation] = useState({ id: "", marksObtained: 0, feedback: "" });
    const load = useCallback(async () => { setLoading(true); try {
        const [a, b] = sort.split(":"), p = new URLSearchParams({ page: String(page), limit: "20", sortBy: a, sortOrder: b });
        Object.entries({ search, branchId: branch, batchId: batch, status, type, due }).forEach(([k, v]) => v && p.set(k, v));
        const [lr, or, dr] = await Promise.all([fetch(`${API}/admin/homeworks?${p}`, { headers: h() }), fetch(`${API}/admin/homeworks/options`, { headers: h() }), fetch(`${API}/admin/homeworks/dashboard`, { headers: h() })]), [l, o, d] = await Promise.all([lr.json(), or.json(), dr.json()]);
        if (!lr.ok || !or.ok || !dr.ok)
            throw Error(l.error?.message ?? o.error?.message ?? d.error?.message ?? "Unable to load homework options");
        setItems(l.data);
        setMeta(l.meta);
        setOptions(o.data);
        setStats(d.data);
        setError("");
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
    }
    finally {
        setLoading(false);
    } }, [page, search, branch, batch, status, type, due, sort]);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const selectedBatch = options.batches.find((item: any) => item.id === form.batchId);
        const ready = form.branchId && form.courseId && form.batchId && form.teacherId && selectedBatch?.academicSession;
        if (!ready) {
            setOptions((current: any) => ({ ...current, subjects: [{ courseId: form.courseId, subject: { id: "", name: "Select a batch and teacher to load allocated subjects" } }] }));
            return;
        }
        const params = new URLSearchParams({ branchId: form.branchId, courseId: form.courseId, batchId: form.batchId, teacherId: form.teacherId, academicSession: selectedBatch.academicSession, effectiveAt: form.assignedDate || new Date().toISOString() });
        fetch(`${API}/admin/subject-options?${params}`, { headers: h() }).then(async response => {
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.error?.message ?? "Unable to load allocated subjects");
            const subjects = result.data.length ? result.data.map((subject: any) => ({ courseId: form.courseId, subject })) : [{ courseId: form.courseId, subject: { id: "", name: "No active teacher allocation matches this homework context" } }];
            setOptions((current: any) => ({ ...current, subjects }));
        }).catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load allocated subjects"));
    }, [form.branchId, form.courseId, form.batchId, form.teacherId, form.assignedDate, options.batches]);
    const update = (k: keyof Form, v: any) => setForm(f => ({ ...f, [k]: v }));
    function open(m: any, x?: Item) { setMode(m); setSelected(x ?? null); if (!x)
        setForm(empty);
    else
        setForm({ title: x.title, description: x.description, branchId: x.branch.id, courseId: x.course.id, batchId: x.batch.id, subjectId: x.subject.id, teacherId: x.teacher.id, timetableId: x.timetable?.id ?? "", type: x.type, assignedDate: x.assignedDate.slice(0, 10), dueDate: x.dueDate.slice(0, 16), maximumMarks: x.maximumMarks, status: x.status, remarks: x.remarks ?? "", attachment: null }); }
    async function upload(e: ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f)
        return; if (f.size > 5 * 1024 * 1024)
        return setError("Attachment must be 5 MB or smaller"); const allowed = ["application/pdf", "image/jpeg", "image/png", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]; if (!allowed.includes(f.type))
        return setError("Use PDF, JPG, PNG, DOC or DOCX"); const base64 = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(f); }); update("attachment", { name: f.name, mimeType: f.type, base64 }); }
    async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); try {
        const r = await fetch(mode === "add" ? `${API}/admin/homeworks` : `${API}/admin/homeworks/${selected!.id}`, { method: mode === "add" ? "POST" : "PATCH", headers: h(), body: JSON.stringify({ ...form, timetableId: form.timetableId || null, remarks: form.remarks || null }) }), j = await r.json();
        if (!r.ok)
            throw Error(j.error?.message);
        setMode(null);
        setNotice("Homework saved");
        await load();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
    }
    finally {
        setSaving(false);
    } }
    async function setState(x: Item, s: string) { const r = await fetch(`${API}/admin/homeworks/${x.id}/status`, { method: "PATCH", headers: h(), body: JSON.stringify({ status: s }) }); if (!r.ok) {
        const j = await r.json();
        setError(j.error?.message);
    }
    else {
        setNotice(`Homework ${s.toLowerCase()}`);
        await load();
    } }
    async function remove() { const r = await fetch(`${API}/admin/homeworks/${selected!.id}`, { method: "DELETE", headers: h() }); if (r.ok) {
        setMode(null);
        setNotice("Homework deleted");
        await load();
    }
    else {
        const j = await r.json();
        setError(j.error?.message);
    } }
    async function evaluate() { const r = await fetch(`${API}/admin/homeworks/submissions/${evaluation.id}/evaluate`, { method: "PATCH", headers: h(), body: JSON.stringify({ marksObtained: evaluation.marksObtained, feedback: evaluation.feedback }) }), j = await r.json(); if (!r.ok)
        return setError(j.error?.message); setNotice("Submission evaluated"); setMode(null); await load(); }
    async function download(format: "excel" | "pdf") { const r = await fetch(`${API}/admin/homeworks/export?format=${format}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } }); if (!r.ok)
        return setError("Export failed"); const u = URL.createObjectURL(await r.blob()), a = document.createElement("a"); a.href = u; a.download = `homework.${format === "excel" ? "xls" : "pdf"}`; a.click(); URL.revokeObjectURL(u); }
    async function attachmentUrl(path: string, name: string) { const r = await fetch(`${API}/admin${path}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } }); if (!r.ok)
        return setError("Download failed"); const u = URL.createObjectURL(await r.blob()), a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); }
    const formCourses = Array.from(new Map(options.batches.filter((x: any) => x.branchId === form.branchId && x.courseId).map((x: any) => [x.courseId, x.course])).entries()).map(([id, course]: any) => ({ id, ...course })), formBatches = options.batches.filter((x: any) => x.branchId === form.branchId && x.courseId === form.courseId), subjects = options.subjects.filter((x: any) => x.courseId === form.courseId), teachers = options.teachers.filter((x: any) => x.branchId === form.branchId), tts = options.timetables.filter((x: any) => x.batchId === form.batchId && x.subjectId === form.subjectId && x.teacherId === form.teacherId);
    return <div className="min-h-screen bg-slate-50"><Sidebar /><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-7xl"><header className="flex flex-wrap justify-between gap-4"><div><p className="text-sm font-bold text-brand-700">ACADEMY OPERATIONS</p><h1 className="text-3xl font-bold">Homework & Assignments</h1><p className="text-sm text-slate-500">Assignments, submissions and evaluation.</p></div><div className="flex gap-2"><button className="btn" onClick={() => download("excel")}><Download size={16}/>Excel</button><button className="btn" onClick={() => download("pdf")}><FileDown size={16}/>PDF</button><button className="btn bg-brand-700 text-white" onClick={() => open("add")}><Plus size={16}/>Add Homework</button></div></header><section className="mt-6 grid gap-3 sm:grid-cols-6">{["total", "published", "overdue", "archived", "submissions", "pendingEvaluation"].map(k => <div key={k} className="rounded-2xl border bg-white p-4"><small className="uppercase text-slate-400">{k}</small><p className="text-2xl font-bold">{stats[k] ?? 0}</p></div>)}</section>{notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">{notice}</p>}{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}<section className="mt-5 grid gap-3 rounded-2xl border bg-white p-4 lg:grid-cols-4"><label className="relative"><Search className="absolute left-3 top-3" size={16}/><input className="field pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Title, description, batch, subject"/></label>{[[branch, setBranch, "All branches", options.branches], [batch, setBatch, "All batches", options.batches], [status, setStatus, "All statuses", ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"].map(x => ({ id: x, name: x }))], [type, setType, "All types", ["HOMEWORK", "ASSIGNMENT", "PROJECT", "PRACTICE", "OTHER"].map(x => ({ id: x, name: x }))], [due, setDue, "All due dates", [{ id: "upcoming", name: "Upcoming" }, { id: "overdue", name: "Overdue" }]]].map(([v, set, label, o]: any, i) => <select key={i} className="field" value={v} onChange={e => { set(e.target.value); setPage(1); }}><option value="">{label}</option>{o.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>)}<select className="field" value={sort} onChange={e => setSort(e.target.value)}><option value="dueDate:asc">Due date</option><option value="assignedDate:desc">Assigned date</option><option value="title:asc">Title</option><option value="maximumMarks:desc">Maximum marks</option></select></section><section className="mt-5 overflow-hidden rounded-2xl border bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50"><tr>{["Homework", "Batch / Subject", "Teacher", "Assigned", "Due", "Marks", "Submissions", "Status", "Actions"].map(x => <th className="px-4 py-3" key={x}>{x}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={9} className="p-16"><Loader2 className="mx-auto animate-spin"/></td></tr> : items.length ? items.map(x => <tr className="border-t" key={x.id}><td className="px-4 py-3"><b>{x.title}</b><br /><span className="text-xs text-slate-500">{x.type}{x.attachmentName ? ` · ${x.attachmentName}` : ""}</span></td><td className="px-4">{x.batch.name}<br />{x.subject.name}</td><td className="px-4">{x.teacher.user.name}</td><td className="px-4">{x.assignedDate.slice(0, 10)}</td><td className="px-4">{new Date(x.dueDate).toLocaleString()}</td><td className="px-4">{x.maximumMarks}</td><td className="px-4">{x._count.submissions}</td><td className="px-4">{x.status}</td><td className="px-4"><div className="flex"><button className="icon" onClick={() => open("view", x)}><Eye size={16}/></button><button className="icon" onClick={() => open("edit", x)}><Edit3 size={16}/></button><button className="icon" onClick={() => setState(x, "ARCHIVED")}><Archive size={16}/></button><button className="icon text-red-600" onClick={() => open("delete", x)}><Trash2 size={16}/></button></div></td></tr>) : <tr><td colSpan={9} className="p-16 text-center"><NotebookPen className="mx-auto text-slate-300"/>No homework found</td></tr>}</tbody></table></div><footer className="flex justify-between border-t p-4"><span>{meta.total} assignments</span><div className="flex gap-2"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft /></button>{meta.page}/{meta.totalPages}<button disabled={page === meta.totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight /></button></div></footer></section></div></main>{mode && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"><div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-6"><div className="flex justify-between"><h2 className="text-xl font-bold">{mode === "add" ? "Add Homework" : mode === "edit" ? "Edit Homework" : mode === "view" ? "Homework Details" : "Safe Delete"}</h2><button onClick={() => setMode(null)}><X /></button></div>{mode === "delete" ? <div><p className="my-6">Only archived homework without submissions can be deleted.</p><button className="btn bg-red-600 text-white" onClick={remove}>Delete safely</button></div> : mode === "view" && selected ? <div className="mt-6"><div className="rounded-xl border p-5"><h3 className="text-xl font-bold">{selected.title}</h3><p className="mt-2">{selected.description}</p>{selected.attachmentName && <button className="btn mt-3" onClick={() => attachmentUrl(`/homeworks/${selected.id}/attachment`, selected.attachmentName!)}><Download size={16}/>{selected.attachmentName}</button>}</div><h3 className="mt-6 font-bold">Student Submissions ({selected.submissions.length})</h3><div className="mt-2 space-y-2">{selected.submissions.map(s => <div key={s.id} className="flex flex-wrap items-center justify-between rounded-xl border p-4"><div><b>{s.student.user.name}</b> · {s.status}<br /><small>{s.submittedAt}</small>{s.attachmentName && <button className="ml-2 text-brand-700" onClick={() => attachmentUrl(`/homeworks/submissions/${s.id}/attachment`, s.attachmentName)}>Download</button>}</div><div>{s.marksObtained != null ? `${s.marksObtained}/${selected.maximumMarks}` : <button className="btn" onClick={() => setEvaluation({ id: s.id, marksObtained: 0, feedback: "" })}>Evaluate</button>}</div></div>)}</div>{evaluation.id && <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3"><input type="number" min="0" max={selected.maximumMarks} className="field" value={evaluation.marksObtained} onChange={e => setEvaluation(v => ({ ...v, marksObtained: Number(e.target.value) }))}/><input className="field" placeholder="Feedback" value={evaluation.feedback} onChange={e => setEvaluation(v => ({ ...v, feedback: e.target.value }))}/><button className="btn bg-brand-700 text-white" onClick={evaluate}>Save Evaluation</button></div>}</div> : <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-3"><label>Title<input required className="field" value={form.title} onChange={e => update("title", e.target.value)}/></label><label>Type<select className="field" value={form.type} onChange={e => update("type", e.target.value)}>{["HOMEWORK", "ASSIGNMENT", "PROJECT", "PRACTICE", "OTHER"].map(x => <option key={x}>{x}</option>)}</select></label><label>Branch<select required className="field" value={form.branchId} onChange={e => setForm(current => ({ ...current, branchId: e.target.value, courseId: "", batchId: "", teacherId: "", subjectId: "", timetableId: "" }))}><option value="">Select</option>{options.branches.map((x: any) => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Course<select required className="field" value={form.courseId} onChange={e => setForm(current => ({ ...current, courseId: e.target.value, batchId: "", subjectId: "", timetableId: "" }))}><option value="">Select</option>{formCourses.map((x: any) => <option value={x.id} key={x.id}>{x.title}</option>)}</select></label><label>Batch / Section<select required className="field" value={form.batchId} onChange={e => setForm(current => ({ ...current, batchId: e.target.value, subjectId: "", timetableId: "" }))}><option value="">Select</option>{formBatches.map((x: any) => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Teacher<select required className="field" value={form.teacherId} onChange={e => setForm(current => ({ ...current, teacherId: e.target.value, subjectId: "", timetableId: "" }))}><option value="">Select</option>{teachers.map((x: any) => <option value={x.id} key={x.id}>{x.user.name}</option>)}</select></label><label>Subject<select required className="field" value={form.subjectId} onChange={e => setForm(current => ({ ...current, subjectId: e.target.value, timetableId: "" }))}><option value="">Select</option>{subjects.map((x: any) => <option value={x.subject.id} key={x.subject.id}>{x.subject.name}</option>)}</select></label><label>Timetable (optional)<select className="field" value={form.timetableId} onChange={e => update("timetableId", e.target.value)}><option value="">None</option>{tts.map((x: any) => <option value={x.id} key={x.id}>{x.day} · Period {x.periodNumber}</option>)}</select></label><label>Assigned Date<input required type="date" className="field" value={form.assignedDate} onChange={e => setForm(current => ({ ...current, assignedDate: e.target.value, subjectId: "", timetableId: "" }))}/></label><label>Due Date<input required type="datetime-local" className="field" value={form.dueDate} onChange={e => update("dueDate", e.target.value)}/></label><label>Maximum Marks<input required type="number" min="1" className="field" value={form.maximumMarks} onChange={e => update("maximumMarks", Number(e.target.value))}/></label><label>Status<select className="field" value={form.status} onChange={e => update("status", e.target.value)}><option>DRAFT</option><option>PUBLISHED</option><option>CLOSED</option><option>ARCHIVED</option></select></label><label>Attachment<input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="field" onChange={upload}/></label><label className="sm:col-span-3">Description<textarea required className="field" value={form.description} onChange={e => update("description", e.target.value)}/></label><label className="sm:col-span-3">Remarks<textarea className="field" value={form.remarks} onChange={e => update("remarks", e.target.value)}/></label><button disabled={saving} className="btn bg-brand-700 text-white sm:col-span-3">{saving && <Loader2 className="animate-spin"/>}Save Homework</button></form>}</div></div>}<style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:transparent}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-size:.875rem;font-weight:700}.icon{padding:.45rem;border-radius:.5rem}.icon:hover{background:#eff6ff}`}</style></div>;
}
export default function Page() { return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><Content /></AuthGate>; }
