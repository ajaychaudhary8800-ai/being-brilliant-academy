"use client";

import { CheckCircle2, Loader2, Search, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getAccessToken } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });
type Option = { id: string; name: string };
type Session = Option & { isArchived: boolean };
type CourseSelection = { batchIds: string[]; subjectIds: string[]; batches: Option[]; subjects: Option[]; loading: boolean };
type PreviewRow = { courseId: string; courseTitle: string; batchId: string; batchName: string; subjectId: string; subjectName: string };
const read = async (response: Response) => { const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error?.message ?? "Request failed"); return body; };

export default function BulkAllocationDialog({ sessions, branches, close, saved }: { sessions: Session[]; branches: Option[]; close: () => void; saved: (count: number) => Promise<void> }) {
  const [academicSessionId, setSession] = useState(""); const [branchId, setBranch] = useState(""); const [teacherId, setTeacher] = useState("");
  const [teachers, setTeachers] = useState<Option[]>([]); const [courses, setCourses] = useState<Option[]>([]); const [courseQuery, setCourseQuery] = useState("");
  const [selections, setSelections] = useState<Record<string, CourseSelection>>({}); const [weeklyPeriods, setWeeklyPeriods] = useState("6");
  const [effectiveFrom, setEffectiveFrom] = useState(""); const [effectiveTo, setEffectiveTo] = useState(""); const [remarks, setRemarks] = useState(""); const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null); const [conflicts, setConflicts] = useState(0); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const sessionName = sessions.find(item => item.id === academicSessionId)?.name ?? "";
  const visibleCourses = useMemo(() => courses.filter(course => course.name.toLowerCase().includes(courseQuery.toLowerCase())), [courses, courseQuery]);
  const clearPreview = () => { setPreview(null); setConflicts(0); };

  useEffect(() => {
    setSelections({}); setTeacher(""); clearPreview();
    if (!branchId) { setCourses([]); setTeachers([]); return; }
    Promise.all([
      fetch(`${API}/admin/courses?limit=100&branchId=${branchId}`, { headers: headers() }).then(read),
      fetch(`${API}/admin/teachers?limit=100&branchId=${branchId}&status=active`, { headers: headers() }).then(read),
    ]).then(([courseData, teacherData]) => {
      setCourses((courseData.data ?? []).map((item: { id: string; title: string }) => ({ id: item.id, name: item.title })));
      setTeachers((teacherData.data ?? []).map((item: { id: string; employeeNo: string; user: { name: string } }) => ({ id: item.id, name: `${item.user.name} (${item.employeeNo})` })));
    }).catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load branch options"));
  }, [branchId]);

  const toggleCourse = async (courseId: string, checked: boolean) => {
    clearPreview();
    if (!checked) { setSelections(current => { const next = { ...current }; delete next[courseId]; return next; }); return; }
    setSelections(current => ({ ...current, [courseId]: { batchIds: [], subjectIds: [], batches: [], subjects: [], loading: true } }));
    try {
      const batchParams = new URLSearchParams({ limit: "100", branchId, courseId, academicSession: sessionName });
      const [batchData, subjectData] = await Promise.all([
        fetch(`${API}/admin/batches?${batchParams}`, { headers: headers() }).then(read),
        fetch(`${API}/admin/allocation-subject-options?teacherId=${teacherId}&courseId=${courseId}`, { headers: headers() }).then(read),
      ]);
      setSelections(current => ({ ...current, [courseId]: {
        batchIds: [], subjectIds: [], loading: false,
        batches: (batchData.data ?? []).map((item: { id: string; name: string; code: string }) => ({ id: item.id, name: `${item.name} (${item.code})` })),
        subjects: (subjectData.data ?? []).map((item: { id: string; name: string; code: string }) => ({ id: item.id, name: `${item.name} (${item.code})` })),
      } }));
    } catch (cause) { setSelections(current => ({ ...current, [courseId]: { ...current[courseId], loading: false } })); setError(cause instanceof Error ? cause.message : "Unable to load course allocation options"); }
  };
  const toggleItem = (courseId: string, key: "batchIds" | "subjectIds", itemId: string, checked: boolean) => { clearPreview(); setSelections(current => ({ ...current, [courseId]: { ...current[courseId], [key]: checked ? [...current[courseId][key], itemId] : current[courseId][key].filter(id => id !== itemId) } })); };
  const payload = () => ({ academicSessionId, branchId, teacherId, selections: Object.entries(selections).map(([courseId, item]) => ({ courseId, batchIds: item.batchIds, subjectIds: item.subjectIds })), weeklyPeriods: Number(weeklyPeriods), effectiveFrom, effectiveTo: effectiveTo || null, remarks: remarks || null, status });
  const requestPreview = async (event: FormEvent) => { event.preventDefault(); setLoading(true); setError(""); try { const body = await fetch(`${API}/admin/teacher-allocations/preview`, { method: "POST", headers: headers(), body: JSON.stringify(payload()) }).then(read); setPreview(body.data.rows); setConflicts(body.data.conflicts.length); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to preview allocations"); } finally { setLoading(false); } };
  const confirm = async () => { setLoading(true); setError(""); try { const body = await fetch(`${API}/admin/teacher-allocations/bulk`, { method: "POST", headers: headers(), body: JSON.stringify(payload()) }).then(read); await saved(body.meta.created); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create allocations"); setLoading(false); } };
  const ready = academicSessionId && branchId && teacherId && effectiveFrom && Object.keys(selections).length > 0 && Object.values(selections).every(item => item.batchIds.length && item.subjectIds.length);

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4"><form onSubmit={requestPreview} className="mx-auto my-8 max-w-4xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
    <div className="flex justify-between"><div><h2 className="text-xl font-bold">Add allocations</h2><p className="mt-1 text-sm text-slate-500">Select multiple courses, groups and valid teacher/course subjects. Each result remains one normalized allocation.</p></div><button type="button" onClick={close}><X /></button></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Academic Session"><select required value={academicSessionId} onChange={event => { setSession(event.target.value); setSelections({}); clearPreview(); }} className="input"><option value="">Select session</option>{sessions.map(session => <option disabled={session.isArchived} key={session.id} value={session.id}>{session.name}{session.isArchived ? " (Archived)" : ""}</option>)}</select></Field><Field label="Branch"><select required value={branchId} onChange={event => setBranch(event.target.value)} className="input"><option value="">Select branch</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field><Field label="Teacher"><select required disabled={!branchId} value={teacherId} onChange={event => { setTeacher(event.target.value); setSelections({}); clearPreview(); }} className="input"><option value="">Select teacher</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></Field><Field label="Weekly Periods"><input required type="number" min="1" max="100" value={weeklyPeriods} onChange={event => { setWeeklyPeriods(event.target.value); clearPreview(); }} className="input" /></Field><Field label="Effective From"><input required type="date" value={effectiveFrom} onChange={event => { setEffectiveFrom(event.target.value); clearPreview(); }} className="input" /></Field><Field label="Effective To"><input type="date" min={effectiveFrom} value={effectiveTo} onChange={event => { setEffectiveTo(event.target.value); clearPreview(); }} className="input" /></Field><Field label="Status"><select value={status} onChange={event => { setStatus(event.target.value as typeof status); clearPreview(); }} className="input"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></Field></div>
    <fieldset disabled={!academicSessionId || !branchId || !teacherId} className="mt-6 disabled:opacity-50"><legend className="font-bold">Courses, groups and subjects</legend><label className="relative mt-3 block"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input value={courseQuery} onChange={event => setCourseQuery(event.target.value)} placeholder="Search courses" className="input pl-9" /></label><div className="mt-3 space-y-3">{visibleCourses.map(course => { const selection = selections[course.id]; return <section key={course.id} className="rounded-xl border p-4"><label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={Boolean(selection)} onChange={event => void toggleCourse(course.id, event.target.checked)} />{course.name}</label>{selection && <div className="mt-4 grid gap-4 sm:grid-cols-2">{selection.loading ? <p className="col-span-2 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} />Loading valid options…</p> : <><ChoiceList title="Batch / Section / Group" options={selection.batches} selected={selection.batchIds} empty="No group matches this course and session." onToggle={(id, checked) => toggleItem(course.id, "batchIds", id, checked)} /><ChoiceList title="Subjects" options={selection.subjects} selected={selection.subjectIds} empty="No common active teacher/course subjects." onToggle={(id, checked) => toggleItem(course.id, "subjectIds", id, checked)} /></>}</div>}</section>; })}{!visibleCourses.length && <p className="rounded-xl border p-4 text-sm text-slate-500">No courses found for this branch.</p>}</div></fieldset>
    <label className="mt-5 flex flex-col gap-1.5 text-sm font-semibold">Remarks<textarea rows={3} maxLength={2000} value={remarks} onChange={event => { setRemarks(event.target.value); clearPreview(); }} className="input font-normal" /></label>
    {preview && <section className="mt-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><h3 className="font-bold">Preview: {preview.length} normalized allocation{preview.length === 1 ? "" : "s"}</h3>{conflicts > 0 && <p className="mt-2 text-sm font-semibold text-red-600">{conflicts} active allocation conflict{conflicts === 1 ? "" : "s"} must be resolved before saving.</p>}<div className="mt-3 max-h-52 overflow-y-auto text-sm">{preview.map((row, index) => <p key={`${row.courseId}-${row.batchId}-${row.subjectId}-${index}`} className="border-t py-2 first:border-0"><b>{row.courseTitle}</b> → {row.batchName} → {row.subjectName}</p>)}</div></section>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={close} className="rounded-lg border px-4 py-2 font-semibold">Cancel</button>{preview ? <button type="button" disabled={loading || conflicts > 0} onClick={() => void confirm()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{loading && <Loader2 className="animate-spin" size={16} />}<CheckCircle2 size={16} />Create {preview.length} allocations</button> : <button disabled={loading || !ready} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{loading && <Loader2 className="animate-spin" size={16} />}Preview allocations</button>}</div>
  </form><style jsx>{`.input{width:100%;border:1px solid rgb(203 213 225);border-radius:.75rem;background:transparent;padding:.625rem .75rem}`}</style></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="flex flex-col gap-1.5 text-sm font-semibold">{label}{children}</label>; }
function ChoiceList({ title, options, selected, empty, onToggle }: { title: string; options: Option[]; selected: string[]; empty: string; onToggle: (id: string, checked: boolean) => void }) { return <fieldset><legend className="text-sm font-semibold">{title}</legend><div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">{options.map(option => <label key={option.id} className="flex items-center gap-2 rounded p-1.5 text-sm"><input type="checkbox" checked={selected.includes(option.id)} onChange={event => onToggle(option.id, event.target.checked)} />{option.name}</label>)}{!options.length && <p className="p-1.5 text-sm text-slate-500">{empty}</p>}</div></fieldset>; }
