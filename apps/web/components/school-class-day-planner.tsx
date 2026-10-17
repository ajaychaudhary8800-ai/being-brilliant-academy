"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, X } from "lucide-react";
import { getAccessToken } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
type Day = (typeof DAYS)[number];
type Options = { branches: any[]; batches: any[] };
type Period = { id: string; periodNumber: number; startMinute: number; endMinute: number; type: "TEACHING" | "BREAK"; label: string | null };
type Allocation = { id: string; teacherId: string; subjectId: string; weeklyPeriods: number;
  teacher: { user: { name: string } }; subject: { name: string } };
type Classroom = { id: string; name: string };
type Existing = { id: string; periodNumber: number; startMinute: number; endMinute: number;
  subject: { name: string }; teacher: { user: { name: string } }; classroom: { name: string }; status: string };
type Schedule = { batch: { id: string; name: string; course: { title: string }; academicSession: string };
  periods: Period[]; allocations: Allocation[]; classrooms: Classroom[]; existing: Existing[] };
type Slot = { allocationId: string; classroomId: string };
type Conflict = { periodNumber: number; code: string; message: string };
type Preview = { requested: number; available: number; conflicts: Conflict[] };

const clock = (minute: number) => String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
const headers = () => ({ "Content-Type": "application/json", Authorization: "Bearer " + (getAccessToken() ?? "") });
async function json(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Error(payload?.error?.message ?? "School timetable request failed");
  return payload;
}

export default function SchoolClassDayPlanner({ options, onClose, onSaved }: {
  options: Options; onClose: () => void; onSaved: (count: number) => Promise<void>;
}) {
  const [branchId, setBranchId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [day, setDay] = useState<Day>("MONDAY");
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [slots, setSlots] = useState<Record<number, Slot>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const courses = useMemo(() => Array.from(new Map(options.batches.filter(row => row.branchId === branchId)
    .map(row => [row.courseId, { id: row.courseId, name: row.course?.title ?? row.courseId }])).values()), [options.batches, branchId]);
  const batches = options.batches.filter(row => row.branchId === branchId && row.courseId === courseId);
  const occupied = useMemo(() => new Map(schedule?.existing.map(row => [row.periodNumber, row]) ?? []), [schedule]);
  const teaching = schedule?.periods.filter(p => p.type === "TEACHING") ?? [];
  const unsaved = Object.values(slots).some(s => Boolean(s.allocationId));
  const selections = teaching.filter(p => !occupied.has(p.periodNumber)).flatMap(p => {
    const chosen = slots[p.periodNumber];
    const allocation = schedule?.allocations.find(a => a.id === chosen?.allocationId);
    return allocation && chosen?.classroomId
      ? [{ periodNumber: p.periodNumber, subjectId: allocation.subjectId, teacherId: allocation.teacherId, classroomId: chosen.classroomId }]
      : [];
  });
  const incomplete = teaching.some(p => !occupied.has(p.periodNumber) && slots[p.periodNumber]?.allocationId && !slots[p.periodNumber]?.classroomId);

  function resetPlan() { setSlots({}); setPreview(null); setError(""); setNotice(""); }
  function changeSection(next: { branchId?: string; courseId?: string; batchId?: string }) {
    if (unsaved && !window.confirm("Discard unsaved timetable selections?")) return;
    setBranchId(next.branchId ?? branchId);
    setCourseId(next.courseId ?? (next.branchId !== undefined ? "" : courseId));
    setBatchId(next.batchId ?? (next.branchId !== undefined || next.courseId !== undefined ? "" : batchId));
    setSchedule(null); resetPlan();
  }
  function changeDay(next: Day) {
    if (unsaved && !window.confirm("Discard unsaved timetable selections for this day?")) return;
    setDay(next); setSchedule(null); resetPlan();
  }
  function setSlot(period: number, update: Partial<Slot>) {
    setSlots(previous => ({ ...previous, [period]: { ...(previous[period] ?? { allocationId: "", classroomId: "" }), ...update } }));
    setPreview(null); setError(""); setNotice("");
  }

  useEffect(() => {
    if (!batchId) { setSchedule(null); return; }
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ batchId, day });
    fetch(API + "/admin/timetables/school-day?" + params, { headers: headers(), signal: controller.signal })
      .then(json).then(result => { if (!controller.signal.aborted) { setSchedule(result.data); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "Unable to load school day"); setSchedule(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [batchId, day, notice]);

  async function reload() {
    const params = new URLSearchParams({ batchId, day });
    const result = await fetch(API + "/admin/timetables/school-day?" + params, { headers: headers() }).then(json);
    setSchedule(result.data);
  }
  async function requestPreview() {
    setSaving(true); setError(""); setPreview(null);
    try {
      const result = await fetch(API + "/admin/timetables/school-day/preview", {
        method: "POST", headers: headers(), body: JSON.stringify({ batchId, day, entries: selections }),
      }).then(json);
      setPreview(result.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cannot preview this school day"); }
    finally { setSaving(false); }
  }
  async function save() {
    if (!preview || preview.conflicts.length || incomplete || preview.available !== selections.length) return;
    setSaving(true); setError("");
    try {
      const result = await fetch(API + "/admin/timetables/school-day", {
        method: "POST", headers: headers(), body: JSON.stringify({ batchId, day, entries: selections }),
      }).then(json);
      setSlots({}); setPreview(null);
      await reload(); await onSaved(result.meta.created);
      setNotice(String(result.meta.created) + " teaching periods saved for " + day + ". Select the next day to continue.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cannot save this school day"); }
    finally { setSaving(false); }
  }

  return <div role="dialog" aria-modal="true" aria-label="Class-wise school timetable" className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/65 p-4 print:hidden">
    <div className="mx-auto my-6 w-full max-w-6xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-7">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-xl font-bold"><CalendarDays size={21}/> Class-wise School Timetable</h2>
          <p className="mt-1 text-sm text-slate-600">Choose a class and section, then assign all teaching periods for Monday, Tuesday and subsequent days in order.</p></div>
        <button aria-label="Close school timetable" className="rounded-lg border p-2" onClick={() => { if (!unsaved || window.confirm("Discard unsaved selections?")) onClose(); }}><X size={18}/></button>
      </header>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">Branch
          <select className="field" value={branchId} onChange={e => changeSection({ branchId: e.target.value })}>
            <option value="">Select branch</option>{options.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Class
          <select className="field" value={courseId} onChange={e => changeSection({ courseId: e.target.value })}>
            <option value="">Select class</option>{courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Section
          <select className="field" value={batchId} onChange={e => changeSection({ batchId: e.target.value })}>
            <option value="">Select section</option>{batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>
      <nav aria-label="School days" className="mt-5 flex flex-wrap gap-2">
        {DAYS.map(d => <button key={d} type="button" onClick={() => changeDay(d)}
          className={"rounded-lg border px-4 py-2 text-sm font-semibold " + (day === d ? "bg-brand-700 text-white" : "bg-white text-slate-800")}>
          {d.slice(0, 3)}
        </button>)}
      </nav>
      {loading && <p className="mt-5 flex items-center gap-2"><Loader2 className="animate-spin" size={17}/> Loading day timetable…</p>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {schedule && !loading && <div className="mt-5">
        <p className="mb-3 text-sm font-semibold">{schedule.batch.course.title} · {schedule.batch.name} · {schedule.batch.academicSession} · {day}</p>
        {!schedule.periods.length && <p className="rounded-lg bg-amber-50 p-4 text-sm">No bell schedule has been configured for this day. Go to <a className="font-bold underline" href="/admin/academic-operations?tab=periods">Academic Operations → Period Configuration</a> to add teaching periods and labelled BREAK blocks (Assembly, Lunch, Recess) before building this timetable.</p>}
        {!schedule.classrooms.length && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">No active classroom is available. First add a classroom in <a href="/admin/classrooms" className="font-bold underline">Classrooms</a>.</p>}
        {!schedule.allocations.length && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">No active teacher-subject allocations for this section. Configure <a href="/admin/teacher-allocations" className="font-bold underline">Teacher Allocations</a> first. PT, Music, Art and Activity can be scheduled as instructional subjects.</p>}
        {!!schedule.periods.length && <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-slate-100"><tr><th className="p-3">Period / Block</th><th className="p-3">Time</th><th className="p-3">Subject / Teacher</th><th className="p-3">Classroom</th><th className="p-3">Status</th></tr></thead>
            <tbody>{schedule.periods.map(period => {
              const existing = occupied.get(period.periodNumber);
              const selected = slots[period.periodNumber] ?? { allocationId: "", classroomId: "" };
              const conflict = preview?.conflicts.find(row => row.periodNumber === period.periodNumber);
              return <tr key={period.id} className={"border-t " + (period.type === "BREAK" ? "bg-amber-50" : "")}>
                <td className="p-3 font-semibold">{period.type === "BREAK" ? (period.label || "Break") : (period.label || "Period " + period.periodNumber)}</td>
                <td className="p-3 whitespace-nowrap">{clock(period.startMinute)}–{clock(period.endMinute)}</td>
                <td className="p-3">{period.type === "BREAK" ? <span className="font-medium">Whole-school non-teaching block (no teacher needed)</span>
                  : existing ? <span>{existing.subject.name} · {existing.teacher.user.name}</span>
                  : <select aria-label={"Subject and teacher for period " + period.periodNumber} className="field" value={selected.allocationId}
                    onChange={e => setSlot(period.periodNumber, { allocationId: e.target.value })}>
                    <option value="">Unassigned — select subject and teacher</option>
                    {schedule.allocations.map(a => <option key={a.id} value={a.id}>{a.subject.name} — {a.teacher.user.name} ({a.weeklyPeriods}/week)</option>)}
                  </select>}
                </td>
                <td className="p-3">{period.type === "BREAK" ? "—" : existing ? existing.classroom.name
                  : <select aria-label={"Classroom for period " + period.periodNumber} className="field" value={selected.classroomId}
                    onChange={e => setSlot(period.periodNumber, { classroomId: e.target.value })}>
                    <option value="">Select classroom</option>
                    {schedule.classrooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>}</td>
                <td className="p-3">{period.type === "BREAK" ? "Break / assembly" : existing ? "Scheduled" : conflict
                  ? <span className="text-red-700">{conflict.message}</span> : selected.allocationId && selected.classroomId ? "Ready" : "Empty"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        <p className="mt-3 text-xs text-slate-600">Assembly, Lunch and Recess are configured once as BREAK blocks in the branch bell schedule; they do not require subjects, teacher allocation or room bookings. PT, Music, Library and Activity lessons are teaching subjects with assigned teachers. Existing lessons are read-only here; use the standard timetable edit action to change them.</p>
        {preview && <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm" aria-live="polite">
          <strong>Preview: {preview.requested} requested · {preview.available} available · {preview.conflicts.length} conflicts</strong>
          {!!preview.conflicts.length && <p className="mt-2 text-red-700">Resolve all conflicts before saving. No timetable records were created.</p>}
        </div>}
      </div>}
      <footer className="mt-6 flex flex-wrap justify-end gap-3 border-t pt-5">
        <button type="button" className="btn" onClick={() => { if (!unsaved || window.confirm("Discard unsaved selections?")) onClose(); }}>Close</button>
        <button type="button" disabled={!schedule || loading || saving || incomplete || !selections.length || !schedule.periods.length}
          className="btn bg-brand-700 text-white disabled:opacity-40" onClick={() => void requestPreview()}>
          {saving && <Loader2 size={16} className="animate-spin"/>} Preview {selections.length} new periods
        </button>
        <button type="button" disabled={!preview || preview.conflicts.length > 0 || preview.available !== selections.length || saving || incomplete}
          className="btn bg-emerald-700 text-white disabled:opacity-40" onClick={() => void save()}>
          Save School Day
        </button>
      </footer>
    </div>
  </div>;
}
