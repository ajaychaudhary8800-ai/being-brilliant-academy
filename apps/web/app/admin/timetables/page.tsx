"use client";
import AcademicSessionSelect from "../../../components/academic-session-select";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Archive, CalendarDays, ChevronLeft, ChevronRight, Download, Edit3, Eye, FileDown, Loader2, Plus, Printer, Search, Trash2, X } from "lucide-react";
import { AuthGate, getAccessToken } from "../../../components/auth-provider";
import Sidebar from "../../../components/sidebar";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1", heads = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` }), days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
type Row = {
    id: string;
    day: string;
    startTime: string;
    endTime: string;
    periodNumber: number;
    academicSession: string;
    remarks: string | null;
    status: string;
    branch: {
        id: string;
        name: string;
    };
    course: {
        id: string;
        title: string;
    };
    batch: {
        id: string;
        name: string;
    };
    subject: {
        id: string;
        name: string;
    };
    teacher: {
        id: string;
        user: {
            name: string;
        };
    };
    classroom: {
        id: string;
        name: string;
    };
};
type Opt = {
    branches: any[];
    batches: any[];
    teachers: any[];
    classrooms: any[];
    subjects: any[];
};
type Form = {
    branchId: string;
    courseId: string;
    batchId: string;
    subjectId: string;
    teacherId: string;
    classroomId: string;
    day: string;
    startTime: string;
    endTime: string;
    periodNumber: number;
    academicSession: string;
    remarks: string;
    status: string;
};
const empty: Form = { branchId: "", courseId: "", batchId: "", subjectId: "", teacherId: "", classroomId: "", day: "MONDAY", startTime: "09:00", endTime: "10:00", periodNumber: 1, academicSession: "", remarks: "", status: "ACTIVE" };
function Content() {
    const [rows, setRows] = useState<Row[]>([]), [opts, setOpts] = useState<Opt>({ branches: [], batches: [], teachers: [], classrooms: [], subjects: [] }), [stats, setStats] = useState<any>({}), [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1, limit: 20 }), [page, setPage] = useState(1), [search, setSearch] = useState(""), [branch, setBranch] = useState(""), [batch, setBatch] = useState(""), [day, setDay] = useState(""), [status, setStatus] = useState(""), [sort, setSort] = useState("day:asc"), [view, setView] = useState<"weekly" | "daily" | "list">("weekly"), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState(""), [mode, setMode] = useState<"add" | "edit" | "view" | "delete" | null>(null), [selected, setSelected] = useState<Row | null>(null), [form, setForm] = useState<Form>(empty), [saving, setSaving] = useState(false);
    const load = useCallback(async () => { setLoading(true); try {
        const [sortBy, sortOrder] = sort.split(":"), p = new URLSearchParams({ page: String(page), limit: "20", sortBy, sortOrder });
        Object.entries({ search, branchId: branch, batchId: batch, day, status }).forEach(([k, v]) => v && p.set(k, v));
        const [r, o, d] = await Promise.all([fetch(`${API}/admin/timetables?${p}`, { headers: heads() }), fetch(`${API}/admin/timetables/options`, { headers: heads() }), fetch(`${API}/admin/timetables/dashboard`, { headers: heads() })]), [j, oj, dj] = await Promise.all([r.json(), o.json(), d.json()]);
        if (!r.ok)
            throw Error(j.error?.message);
        setRows(j.data);
        setMeta(j.meta);
        setOpts(oj.data);
        setStats(dj.data);
        setError("");
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load timetable");
    }
    finally {
        setLoading(false);
    } }, [page, search, branch, batch, day, status, sort]);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const ready = form.branchId && form.courseId && form.batchId && form.teacherId && form.academicSession;
        if (!ready) {
            setOpts(current => ({ ...current, subjects: [{ courseId: form.courseId, subject: { id: "", name: "Select a batch, teacher and session to load allocated subjects" } }] }));
            return;
        }
        const params = new URLSearchParams({ branchId: form.branchId, courseId: form.courseId, batchId: form.batchId, teacherId: form.teacherId, academicSession: form.academicSession });
        fetch(`${API}/admin/subject-options?${params}`, { headers: heads() }).then(async response => {
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.error?.message ?? "Unable to load allocated subjects");
            const subjects = result.data.length ? result.data.map((subject: any) => ({ courseId: form.courseId, subject })) : [{ courseId: form.courseId, subject: { id: "", name: "No active teacher allocation matches this batch and session" } }];
            setOpts(current => ({ ...current, subjects }));
        }).catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load allocated subjects"));
    }, [form.branchId, form.courseId, form.batchId, form.teacherId, form.academicSession]);
    const update = (k: keyof Form, v: any) => setForm(f => ({ ...f, [k]: v }));
    function open(m: any, r?: Row) { setMode(m); setSelected(r ?? null); if (!r)
        setForm(empty);
    else
        setForm({ branchId: r.branch.id, courseId: r.course.id, batchId: r.batch.id, subjectId: r.subject.id, teacherId: r.teacher.id, classroomId: r.classroom.id, day: r.day, startTime: r.startTime, endTime: r.endTime, periodNumber: r.periodNumber, academicSession: r.academicSession, remarks: r.remarks ?? "", status: r.status }); }
    async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); try {
        const r = await fetch(mode === "add" ? `${API}/admin/timetables` : `${API}/admin/timetables/${selected!.id}`, { method: mode === "add" ? "POST" : "PATCH", headers: heads(), body: JSON.stringify({ ...form, remarks: form.remarks || null }) }), j = await r.json();
        if (!r.ok)
            throw Error(j.error?.message);
        setMode(null);
        setNotice(mode === "add" ? "Period added" : "Period updated");
        await load();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
    }
    finally {
        setSaving(false);
    } }
    async function archive(r: Row) { const x = await fetch(`${API}/admin/timetables/${r.id}/status`, { method: "PATCH", headers: heads(), body: JSON.stringify({ status: "ARCHIVED" }) }); if (!x.ok) {
        const j = await x.json();
        setError(j.error?.message);
    }
    else {
        setNotice("Period archived");
        await load();
    } }
    async function remove() { setSaving(true); const r = await fetch(`${API}/admin/timetables/${selected!.id}`, { method: "DELETE", headers: heads() }); if (r.ok) {
        setMode(null);
        setNotice("Archived period deleted");
        await load();
    }
    else {
        const j = await r.json();
        setError(j.error?.message);
    } setSaving(false); }
    async function download(format: "excel" | "pdf") { const r = await fetch(`${API}/admin/timetables/export?format=${format}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } }); if (!r.ok)
        return setError("Export failed"); const u = URL.createObjectURL(await r.blob()), a = document.createElement("a"); a.href = u; a.download = `timetable.${format === "excel" ? "xls" : "pdf"}`; a.click(); URL.revokeObjectURL(u); }
    const visible = view === "daily" ? rows.filter(r => r.day === (day || days[(new Date().getDay() + 6) % 7])) : rows, chosenBatch = opts.batches.find(x => x.id === form.batchId), formSubjects = opts.subjects.filter(x => x.courseId === form.courseId), formTeachers = opts.teachers.filter(x => x.branchId === form.branchId), rooms = opts.classrooms.filter(x => x.branchId === form.branchId);
    return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><Sidebar /><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-7xl"><header className="flex flex-wrap justify-between gap-4"><div><p className="text-sm font-bold text-brand-700">ACADEMY OPERATIONS</p><h1 className="text-3xl font-bold">Timetable Management</h1><p className="text-sm text-slate-500">Conflict-safe weekly academic scheduling.</p></div><div className="flex flex-wrap gap-2"><button className="btn" onClick={() => window.print()}><Printer size={16}/>Print</button><button className="btn" onClick={() => download("excel")}><Download size={16}/>Excel</button><button className="btn" onClick={() => download("pdf")}><FileDown size={16}/>PDF</button><button className="btn bg-brand-700 text-white" onClick={() => open("add")}><Plus size={16}/>Add Period</button></div></header><section className="mt-6 grid gap-3 sm:grid-cols-5">{[["Total", stats.total], ["Active", stats.active], ["Archived", stats.archived], ["Teachers", stats.teachers], ["Classrooms", stats.classrooms]].map(([a, b]) => <div key={a} className="rounded-2xl border bg-white p-4"><p className="text-xs font-bold uppercase text-slate-400">{a}</p><p className="text-2xl font-bold">{b ?? 0}</p></div>)}</section>{notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">{notice}</p>}{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}<section className="mt-5 grid gap-3 rounded-2xl border bg-white p-4 lg:grid-cols-4"><label className="relative"><Search className="absolute left-3 top-3" size={16}/><input className="field pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Batch, subject, teacher, room"/></label>{[[branch, setBranch, "All branches", opts.branches], [batch, setBatch, "All batches", opts.batches], [day, setDay, "All days", days.map(x => ({ id: x, name: x }))], [status, setStatus, "All statuses", ["ACTIVE", "INACTIVE", "ARCHIVED"].map(x => ({ id: x, name: x }))]].map(([v, set, label, o]: any, i) => <select key={i} className="field" value={v} onChange={e => { set(e.target.value); setPage(1); }}><option value="">{label}</option>{o.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>)}<select className="field" value={sort} onChange={e => setSort(e.target.value)}><option value="day:asc">Day</option><option value="startMinute:asc">Start time</option><option value="periodNumber:asc">Period</option><option value="createdAt:desc">Newest</option></select><div className="flex rounded-xl border p-1">{(["weekly", "daily", "list"] as const).map(x => <button key={x} onClick={() => setView(x)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold ${view === x ? "bg-brand-700 text-white" : ""}`}>{x}</button>)}</div></section><section className="mt-5 overflow-hidden rounded-2xl border bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50"><tr>{["Day / Time", "Period", "Branch", "Course / Batch", "Subject", "Teacher", "Classroom", "Session", "Status", "Actions"].map(x => <th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={10} className="p-16"><Loader2 className="mx-auto animate-spin"/></td></tr> : visible.length ? visible.map(r => <tr key={r.id} className="border-t"><td className="px-4 py-3"><b>{r.day}</b><br />{r.startTime}–{r.endTime}</td><td className="px-4">{r.periodNumber}</td><td className="px-4">{r.branch.name}</td><td className="px-4">{r.course.title}<br /><span className="text-slate-500">{r.batch.name}</span></td><td className="px-4 font-semibold">{r.subject.name}</td><td className="px-4">{r.teacher.user.name}</td><td className="px-4">{r.classroom.name}</td><td className="px-4">{r.academicSession}</td><td className="px-4">{r.status}</td><td className="px-4"><div className="flex"><button className="icon" onClick={() => open("view", r)}><Eye size={16}/></button><button className="icon" onClick={() => open("edit", r)}><Edit3 size={16}/></button><button className="icon" onClick={() => archive(r)}><Archive size={16}/></button><button className="icon text-red-600" onClick={() => open("delete", r)}><Trash2 size={16}/></button></div></td></tr>) : <tr><td colSpan={10} className="p-16 text-center"><CalendarDays className="mx-auto text-slate-300"/><p>No timetable entries found</p></td></tr>}</tbody></table></div><footer className="flex justify-between border-t p-4 text-sm"><span>{meta.total} periods</span><div className="flex items-center gap-2"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft /></button>Page {meta.page}/{meta.totalPages}<button disabled={page === meta.totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight /></button></div></footer></section></div></main>{mode && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 print:hidden"><div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-6"><div className="flex justify-between"><h2 className="text-xl font-bold">{mode === "add" ? "Add Period" : mode === "edit" ? "Edit Period" : mode === "view" ? "Period Details" : "Safe Delete"}</h2><button onClick={() => setMode(null)}><X /></button></div>{mode === "delete" ? <div><p className="my-6">Only archived periods can be deleted. Delete this period?</p><button className="btn bg-red-600 text-white" onClick={remove}>Delete</button></div> : mode === "view" ? <div className="mt-6 grid gap-4 sm:grid-cols-2">{selected && Object.entries({ Day: selected.day, Time: `${selected.startTime}–${selected.endTime}`, Period: selected.periodNumber, Branch: selected.branch.name, Course: selected.course.title, Batch: selected.batch.name, Subject: selected.subject.name, Teacher: selected.teacher.user.name, Classroom: selected.classroom.name, Session: selected.academicSession, Status: selected.status, Remarks: selected.remarks }).map(([k, v]) => <div key={k} className="rounded-xl border p-4"><small>{k}</small><p className="font-bold">{v ?? "—"}</p></div>)}</div> : <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-3"><label>Branch<select required className="field" value={form.branchId} onChange={e => { update("branchId", e.target.value); update("batchId", ""); update("courseId", ""); update("teacherId", ""); update("classroomId", ""); }}><option value="">Select</option>{opts.branches.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Course / Batch<select required className="field" value={form.batchId} onChange={e => { const b = opts.batches.find(x => x.id === e.target.value); update("batchId", e.target.value); if (b) {
        update("courseId", b.courseId);
        update("academicSession", b.academicSession);
    } }}><option value="">Select</option>{opts.batches.filter(x => x.branchId === form.branchId && x.courseId).map(x => <option key={x.id} value={x.id}>{x.course.title} — {x.name}</option>)}</select></label><label>Subject<select required className="field" value={form.subjectId} onChange={e => update("subjectId", e.target.value)}><option value="">Select</option>{formSubjects.map(x => <option key={x.subject.id} value={x.subject.id}>{x.subject.name}</option>)}</select></label><label>Teacher<select required className="field" value={form.teacherId} onChange={e => update("teacherId", e.target.value)}><option value="">Select</option>{formTeachers.map(x => <option key={x.id} value={x.id}>{x.user.name}</option>)}</select></label><label>Classroom<select required className="field" value={form.classroomId} onChange={e => update("classroomId", e.target.value)}><option value="">Select</option>{rooms.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Day<select className="field" value={form.day} onChange={e => update("day", e.target.value)}>{days.map(x => <option key={x}>{x}</option>)}</select></label><label>Start Time<input required type="time" className="field" value={form.startTime} onChange={e => update("startTime", e.target.value)}/></label><label>End Time<input required type="time" className="field" value={form.endTime} onChange={e => update("endTime", e.target.value)}/></label><label>Period Number<input required type="number" min="1" className="field" value={form.periodNumber} onChange={e => update("periodNumber", Number(e.target.value))}/></label><label>Session<AcademicSessionSelect value={form.academicSession} onChange={name => update("academicSession", name)} className="field"/></label><label>Status<select className="field" value={form.status} onChange={e => update("status", e.target.value)}><option>ACTIVE</option><option>INACTIVE</option><option>ARCHIVED</option></select></label><label className="sm:col-span-3">Remarks<textarea className="field" value={form.remarks} onChange={e => update("remarks", e.target.value)}/></label><button disabled={saving} className="btn bg-brand-700 text-white sm:col-span-3">{saving && <Loader2 className="animate-spin"/>}Save Period</button></form>}</div></div>}<style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:transparent}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-size:.875rem;font-weight:700}.icon{padding:.45rem;border-radius:.5rem}.icon:hover{background:#eff6ff}@media print{aside,header,section:not(:last-of-type),footer,.icon{display:none!important}main{margin:0!important;padding:0!important}}`}</style></div>;
}
export default function Page() { return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><Content /></AuthGate>; }
