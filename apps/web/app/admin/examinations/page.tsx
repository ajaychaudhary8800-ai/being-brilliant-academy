"use client";
import AcademicSessionSelect from "../../../components/academic-session-select";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, Download, Edit3, Eye, FileCheck2, FileDown, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { AuthGate, getAccessToken } from "../../../components/auth-provider";
import Sidebar from "../../../components/sidebar";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1", h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` }), types = ["UNIT_TEST", "MID_TERM", "FINAL", "PRACTICAL", "MOCK", "OTHER"], statuses = ["DRAFT", "SCHEDULED", "COMPLETED", "RESULTS_PUBLISHED", "ARCHIVED"];
type Exam = {
    id: string;
    name: string;
    code: string;
    type: string;
    academicSession: string;
    examDate: string;
    startTime: string;
    endTime: string;
    maximumMarks: number;
    passingMarks: number;
    status: string;
    remarks: string | null;
    branch: any;
    course: any;
    batch: any;
    subject: any;
    teacher: any;
    results: any[];
    _count: {
        results: number;
    };
};
const blank: any = { name: "", code: "", type: "UNIT_TEST", branchId: "", courseId: "", batchId: "", subjectId: "", teacherId: "", academicSession: "", examDate: "", startTime: "09:00", endTime: "10:00", maximumMarks: 100, passingMarks: 40, status: "DRAFT", remarks: "" };
function Content() {
    const [items, setItems] = useState<Exam[]>([]), [opts, setOpts] = useState<any>({ branches: [], batches: [], teachers: [], subjects: [], students: [] }), [stats, setStats] = useState<any>({}), [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1, limit: 20 }), [page, setPage] = useState(1), [search, setSearch] = useState(""), [branch, setBranch] = useState(""), [batch, setBatch] = useState(""), [status, setStatus] = useState(""), [type, setType] = useState(""), [session, setSession] = useState(""), [sort, setSort] = useState("examDate:asc"), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState(""), [mode, setMode] = useState<"add" | "edit" | "view" | "marks" | "delete" | null>(null), [selected, setSelected] = useState<Exam | null>(null), [form, setForm] = useState<any>(blank), [marks, setMarks] = useState<Record<string, string>>({});
    const load = useCallback(async () => { setLoading(true); try {
        const [a, b] = sort.split(":"), p = new URLSearchParams({ page: String(page), limit: "20", sortBy: a, sortOrder: b });
        Object.entries({ search, branchId: branch, batchId: batch, status, type, academicSession: session }).forEach(([k, v]) => v && p.set(k, v));
        const [r, o, d] = await Promise.all([fetch(`${API}/admin/examinations?${p}`, { headers: h() }), fetch(`${API}/admin/examinations/options`, { headers: h() }), fetch(`${API}/admin/examinations/dashboard`, { headers: h() })]), [j, oj, dj] = await Promise.all([r.json(), o.json(), d.json()]);
        if (!r.ok)
            throw Error(j.error?.message);
        setItems(j.data);
        setMeta(j.meta);
        setOpts(oj.data);
        setStats(dj.data);
        setError("");
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Load failed");
    }
    finally {
        setLoading(false);
    } }, [page, search, branch, batch, status, type, session, sort]);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const ready = form.branchId && form.courseId && form.batchId && form.teacherId && form.academicSession;
        if (!ready) {
            setOpts((current: any) => ({ ...current, subjects: [{ courseId: form.courseId, subject: { id: "", name: "Select a batch, teacher and session to load allocated subjects" } }] }));
            return;
        }
        const params = new URLSearchParams({ branchId: form.branchId, courseId: form.courseId, batchId: form.batchId, teacherId: form.teacherId, academicSession: form.academicSession, effectiveAt: form.examDate || new Date().toISOString() });
        fetch(`${API}/admin/subject-options?${params}`, { headers: h() }).then(async response => {
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.error?.message ?? "Unable to load allocated subjects");
            const subjects = result.data.length ? result.data.map((subject: any) => ({ courseId: form.courseId, subject })) : [{ courseId: form.courseId, subject: { id: "", name: "No active teacher allocation matches this examination context" } }];
            setOpts((current: any) => ({ ...current, subjects }));
        }).catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load allocated subjects"));
    }, [form.branchId, form.courseId, form.batchId, form.teacherId, form.academicSession, form.examDate]);
    const upd = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
    function open(m: any, x?: Exam) { setMode(m); setSelected(x ?? null); if (!x)
        setForm(blank);
    else {
        setForm({ name: x.name, code: x.code, type: x.type, branchId: x.branch.id, courseId: x.course.id, batchId: x.batch.id, subjectId: x.subject.id, teacherId: x.teacher.id, academicSession: x.academicSession, examDate: x.examDate.slice(0, 10), startTime: x.startTime, endTime: x.endTime, maximumMarks: x.maximumMarks, passingMarks: x.passingMarks, status: x.status, remarks: x.remarks ?? "" });
        setMarks(Object.fromEntries(x.results.map(r => [r.student.id, r.marksObtained == null ? "" : String(r.marksObtained)])));
    } }
    async function submit(e: FormEvent) { e.preventDefault(); const r = await fetch(mode === "add" ? `${API}/admin/examinations` : `${API}/admin/examinations/${selected!.id}`, { method: mode === "add" ? "POST" : "PATCH", headers: h(), body: JSON.stringify({ ...form, remarks: form.remarks || null }) }), j = await r.json(); if (!r.ok)
        return setError(j.error?.message); setMode(null); setNotice("Examination saved"); await load(); }
    async function saveMarks() { const students = opts.students.filter((s: any) => s.batchId === selected!.batch.id), results = students.map((s: any) => ({ studentId: s.id, marksObtained: marks[s.id] === "" || marks[s.id] === undefined ? null : Number(marks[s.id]) })), r = await fetch(`${API}/admin/examinations/${selected!.id}/marks`, { method: "POST", headers: h(), body: JSON.stringify({ results }) }), j = await r.json(); if (!r.ok)
        return setError(j.error?.message); const g = await fetch(`${API}/admin/examinations/${selected!.id}/generate-results`, { method: "POST", headers: h() }), gj = await g.json(); if (!g.ok)
        return setError(gj.error?.message); setMode(null); setNotice("Marks saved and ranked results generated"); await load(); }
    async function state(x: Exam, s: string) { const r = await fetch(`${API}/admin/examinations/${x.id}/status`, { method: "PATCH", headers: h(), body: JSON.stringify({ status: s }) }); if (!r.ok)
        return setError((await r.json()).error?.message); await load(); }
    async function remove() { const r = await fetch(`${API}/admin/examinations/${selected!.id}`, { method: "DELETE", headers: h() }); if (!r.ok)
        return setError((await r.json()).error?.message); setMode(null); await load(); }
    async function download(path: string, name: string) { const r = await fetch(`${API}/admin${path}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } }); if (!r.ok)
        return setError("Export failed"); const u = URL.createObjectURL(await r.blob()), a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); }
    const batches = opts.batches.filter((x: any) => x.branchId === form.branchId), subjects = opts.subjects.filter((x: any) => x.courseId === form.courseId), teachers = opts.teachers.filter((x: any) => x.branchId === form.branchId), students = opts.students.filter((x: any) => x.batchId === selected?.batch.id);
    return <div className="min-h-screen bg-slate-50"><Sidebar /><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-7xl"><header className="flex flex-wrap justify-between gap-4"><div><p className="text-sm font-bold text-brand-700">ACADEMY OPERATIONS</p><h1 className="text-3xl font-bold">Examination Management</h1><p className="text-sm text-slate-500">Schedules, marks, ranks and report cards.</p></div><div className="flex gap-2"><button className="btn" onClick={() => download('/examinations/export?format=excel', 'results.xls')}><Download size={16}/>Excel</button><button className="btn" onClick={() => download('/examinations/export?format=pdf', 'results.pdf')}><FileDown size={16}/>PDF</button><button className="btn bg-brand-700 text-white" onClick={() => open("add")}><Plus size={16}/>Add Examination</button></div></header><section className="mt-6 grid gap-3 sm:grid-cols-6">{["total", "scheduled", "completed", "published", "archived", "results"].map(k => <div key={k} className="rounded-2xl border bg-white p-4"><small className="uppercase text-slate-400">{k}</small><p className="text-2xl font-bold">{stats[k] ?? 0}</p></div>)}</section>{notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">{notice}</p>}{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}<section className="mt-5 grid gap-3 rounded-2xl border bg-white p-4 lg:grid-cols-4"><label className="relative"><Search className="absolute left-3 top-3" size={16}/><input className="field pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Exam, code, batch, subject"/></label>{[[branch, setBranch, "All branches", opts.branches], [batch, setBatch, "All batches", opts.batches], [status, setStatus, "All statuses", statuses.map(x => ({ id: x, name: x }))], [type, setType, "All types", types.map(x => ({ id: x, name: x }))], [session, setSession, "All sessions", Array.from(new Set(opts.batches.map((x: any) => x.academicSession))).map(x => ({ id: x, name: x }))]].map(([v, set, label, o]: any, i) => <select key={i} className="field" value={v} onChange={e => { set(e.target.value); setPage(1); }}><option value="">{label}</option>{o.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>)}<select className="field" value={sort} onChange={e => setSort(e.target.value)}><option value="examDate:asc">Exam date</option><option value="name:asc">Name</option><option value="code:asc">Code</option><option value="maximumMarks:desc">Maximum marks</option></select></section><section className="mt-5 overflow-hidden rounded-2xl border bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50"><tr>{["Exam", "Schedule", "Batch / Subject", "Teacher", "Marks", "Results", "Status", "Actions"].map(x => <th className="px-4 py-3" key={x}>{x}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={8} className="p-16"><Loader2 className="mx-auto animate-spin"/></td></tr> : items.length ? items.map(x => <tr className="border-t" key={x.id}><td className="px-4 py-3"><b>{x.name}</b><br />{x.code} · {x.type}</td><td className="px-4">{x.examDate.slice(0, 10)}<br />{x.startTime}–{x.endTime}</td><td className="px-4">{x.batch.name}<br />{x.subject.name}</td><td className="px-4">{x.teacher.user.name}</td><td className="px-4">{x.passingMarks}/{x.maximumMarks}</td><td className="px-4">{x._count.results}</td><td className="px-4">{x.status}</td><td className="px-4"><div className="flex"><button className="icon" onClick={() => open("view", x)}><Eye size={16}/></button><button className="icon" onClick={() => open("edit", x)}><Edit3 size={16}/></button><button className="icon" title="Marks Entry" onClick={() => open("marks", x)}><FileCheck2 size={16}/></button><button className="icon" onClick={() => state(x, "ARCHIVED")}><Archive size={16}/></button><button className="icon text-red-600" onClick={() => open("delete", x)}><Trash2 size={16}/></button></div></td></tr>) : <tr><td colSpan={8} className="p-16 text-center"><FileCheck2 className="mx-auto text-slate-300"/>No examinations found</td></tr>}</tbody></table></div><footer className="flex justify-between border-t p-4"><span>{meta.total} examinations</span><div className="flex gap-2"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft /></button>{meta.page}/{meta.totalPages}<button disabled={page === meta.totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight /></button></div></footer></section></div></main>{mode && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"><div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-6"><div className="flex justify-between"><h2 className="text-xl font-bold">{mode === "add" ? "Add Examination" : mode === "edit" ? "Edit Examination" : mode === "marks" ? "Marks Entry & Result Generation" : mode === "view" ? "Examination Results" : "Safe Delete"}</h2><button onClick={() => setMode(null)}><X /></button></div>{mode === "delete" ? <div><p className="my-6">Only archived examinations without results can be deleted.</p><button className="btn bg-red-600 text-white" onClick={remove}>Delete safely</button></div> : mode === "marks" ? <div className="mt-5 space-y-2">{students.map((s: any) => <label key={s.id} className="grid grid-cols-[1fr_160px] items-center rounded-xl border p-3"><span><b>{s.user.name}</b> · {s.admissionNo}</span><input className="field" type="number" min="0" max={selected!.maximumMarks} placeholder="Absent" value={marks[s.id] ?? ""} onChange={e => setMarks(m => ({ ...m, [s.id]: e.target.value }))}/></label>)}<button className="btn w-full bg-brand-700 text-white" onClick={saveMarks}>Save Marks & Generate Results</button></div> : mode === "view" && selected ? <div className="mt-5"><div className="rounded-xl border p-4"><b>{selected.name}</b> · {selected.subject.name} · {selected.batch.name}</div><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Student", "Marks", "%", "Grade", "GPA", "Rank", "Status", "Report"].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{selected.results.map(r => <tr className="border-t" key={r.id}><td className="p-2">{r.student.user.name}</td><td>{String(r.marksObtained ?? "Absent")}</td><td>{String(r.percentage ?? "—")}</td><td>{r.grade ?? "—"}</td><td>{String(r.gpa ?? "—")}</td><td>{r.rank ?? "—"}</td><td>{r.status}</td><td><button className="text-brand-700" onClick={() => download(`/examinations/${selected.id}/report-card/${r.student.id}`, `${r.student.admissionNo}-report.pdf`)}>PDF</button></td></tr>)}</tbody></table></div></div> : <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-3">{[["name", "Exam Name"], ["code", "Exam Code"], ["academicSession", "Academic Session"], ["examDate", "Exam Date", "date"], ["startTime", "Start Time", "time"], ["endTime", "End Time", "time"], ["maximumMarks", "Maximum Marks", "number"], ["passingMarks", "Passing Marks", "number"]].map(([k, l, t]) => <label key={k}>{l}{k === "academicSession" ? <AcademicSessionSelect value={form.academicSession} onChange={name => upd("academicSession", name)} className="field"/> : <input required className="field" type={t ?? "text"} value={form[k]} onChange={e => upd(k, t === "number" ? Number(e.target.value) : e.target.value)}/>}</label>)}<label>Exam Type<select className="field" value={form.type} onChange={e => upd("type", e.target.value)}>{types.map(x => <option key={x}>{x}</option>)}</select></label><label>Branch<select required className="field" value={form.branchId} onChange={e => { upd("branchId", e.target.value); upd("batchId", ""); }}><option value="">Select</option>{opts.branches.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Course / Batch<select required className="field" value={form.batchId} onChange={e => { const b = opts.batches.find((x: any) => x.id === e.target.value); upd("batchId", e.target.value); if (b) {
        upd("courseId", b.courseId);
        upd("academicSession", b.academicSession);
    } }}><option value="">Select</option>{batches.map((x: any) => <option key={x.id} value={x.id}>{x.course?.title} — {x.name}</option>)}</select></label><label>Subject<select required className="field" value={form.subjectId} onChange={e => upd("subjectId", e.target.value)}><option value="">Select</option>{subjects.map((x: any) => <option key={x.subject.id} value={x.subject.id}>{x.subject.name}</option>)}</select></label><label>Teacher<select required className="field" value={form.teacherId} onChange={e => upd("teacherId", e.target.value)}><option value="">Select</option>{teachers.map((x: any) => <option key={x.id} value={x.id}>{x.user.name}</option>)}</select></label><label>Status<select className="field" value={form.status} onChange={e => upd("status", e.target.value)}>{statuses.map(x => <option key={x}>{x}</option>)}</select></label><label className="sm:col-span-3">Remarks<textarea className="field" value={form.remarks} onChange={e => upd("remarks", e.target.value)}/></label><button className="btn bg-brand-700 text-white sm:col-span-3">Save Examination</button></form>}</div></div>}<style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:transparent}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-size:.875rem;font-weight:700}.icon{padding:.45rem;border-radius:.5rem}.icon:hover{background:#eff6ff}`}</style></div>;
}
export default function Page() { return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><Content /></AuthGate>; }
