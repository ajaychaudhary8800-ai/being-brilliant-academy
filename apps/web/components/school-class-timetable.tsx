"use client";

import { useEffect, useMemo, useState } from "react";
import { getAccessToken } from "./auth-provider";
import SchoolClassDayGrid, { clock, type BellSlot, type AllocationOption, type ScheduledPeriod, type DraftCell } from "./school-class-day-grid";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const DAYS = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"] as const;
type Day = typeof DAYS[number];
type Batch = { id: string; branchId: string; courseId: string; name: string; academicSession: string;
  academicSessionId: string; course: { title: string } };
type Options = { branches: Array<{ id: string; name: string }>; batches: Batch[];
  classrooms: Array<{ id: string; name: string; branchId: string }> };
type Preview = { count: number; conflicts: Array<{ periodNumber: number; message: string }>; warnings: string[] };
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });
async function json(response: Response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message ?? "Request failed");
  return result;
}

export default function SchoolClassTimetable({ options, onClose, onSaved }: {
  options: Options; onClose: () => void; onSaved: (count: number) => Promise<void>;
}) {
  const [branchId, setBranchId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [day, setDay] = useState<Day>("MONDAY");
  const [roomId, setRoomId] = useState("");
  const [slots, setSlots] = useState<BellSlot[]>([]);
  const [existing, setExisting] = useState<ScheduledPeriod[]>([]);
  const [allocations, setAllocations] = useState<AllocationOption[]>([]);
  const [draft, setDraft] = useState<Record<number, DraftCell>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const batches = options.batches.filter(item => item.branchId === branchId);
  const courses = Array.from(new Map(batches.map(item =>
    [item.courseId, { id: item.courseId, title: item.course.title }])).values());
  const sections = batches.filter(item => item.courseId === courseId);
  const section = options.batches.find(item => item.id === batchId);
  const rooms = options.classrooms.filter(item => item.branchId === branchId);

  useEffect(() => {
    setSlots([]); setExisting([]); setAllocations([]); setDraft({}); setPreview(null);
    setError(""); setNotice("");
    const selected = options.batches.find(item => item.id === batchId);
    if (!selected || !branchId) return;
    const abort = new AbortController();
    const get = (url: string) => fetch(url, { headers: headers(), signal: abort.signal }).then(json);
    const periodQuery = new URLSearchParams({ branchId, academicSessionId: selected.academicSessionId, day });
    const timetableQuery = new URLSearchParams({ batchId, day, limit: "100" });
    const allocationQuery = new URLSearchParams({ branchId, batchId,
      academicSessionId: selected.academicSessionId, status: "ACTIVE", limit: "100" });
    setLoading(true);
    Promise.all([
      get(`${API}/admin/timetable-periods?${periodQuery}`),
      get(`${API}/admin/timetables?${timetableQuery}`),
      get(`${API}/admin/teacher-allocations?${allocationQuery}`),
    ]).then(([periods, lessons, teachers]) => {
      if (abort.signal.aborted) return;
      setSlots((periods.data as BellSlot[]).filter(slot => slot.isActive).sort((a,b) => a.startMinute-b.startMinute));
      setExisting(lessons.data ?? []);
      setAllocations(teachers.data ?? []);
      if (teachers.meta?.total > 100) setError("Too many teacher allocations; refine allocations before continuing.");
    }).catch(cause => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load timetable");
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [batchId, branchId, day, reload, options.batches]);

  function change(period: number, patch: Partial<DraftCell>) {
    setDraft(current => ({ ...current,
      [period]: { allocationId: "", classroomId: "", ...current[period], ...patch } }));
    setPreview(null); setNotice("");
  }
  const planned = useMemo(() => {
    if (!section) return [];
    return slots.filter(slot => slot.type === "TEACHING" &&
      !existing.some(row => row.periodNumber === slot.periodNumber)).flatMap(slot => {
      const cell = draft[slot.periodNumber];
      const staff = allocations.find(item => item.id === cell?.allocationId);
      const classroomId = cell?.classroomId || roomId;
      return !staff || !classroomId ? [] : [{
        branchId, courseId, batchId, subjectId: staff.subjectId, teacherId: staff.teacherId,
        classroomId, day, startTime: clock(slot.startMinute), endTime: clock(slot.endMinute),
        periodNumber: slot.periodNumber, academicSession: section.academicSession, status: "ACTIVE",
      }];
    });
  }, [section, slots, existing, draft, allocations, roomId, branchId, courseId, batchId, day]);

  async function submit(mode: "preview" | "save") {
    setSaving(true); setError("");
    try {
      const response = await fetch(`${API}/admin/timetables/class-day${mode === "preview" ? "/preview" : ""}`, {
        method: "POST", headers: headers(), body: JSON.stringify({ entries: planned }),
      }).then(json);
      if (mode === "preview") setPreview(response.data);
      else {
        const count = Number(response.meta.created);
        setDraft({}); setPreview(null); setReload(value => value + 1);
        await onSaved(count);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Timetable operation failed");
    } finally { setSaving(false); }
  }
  const input = "w-full rounded-xl border border-slate-300 bg-white p-2 text-sm";
  return <div role="dialog" aria-modal="true" aria-label="Class-wise school timetable"
    className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4">
    <div className="mx-auto my-6 max-w-6xl rounded-2xl bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-2xl font-bold">Class-wise School Timetable</h2>
          <p className="mt-1 text-sm text-slate-500">Complete Monday period by period, then switch to Tuesday and the remaining days.</p>
        </div><button type="button" onClick={onClose} aria-label="Close" className="rounded-xl border px-3 py-2">Close</button>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold">Branch<select className={input} value={branchId}
          onChange={e => { setBranchId(e.target.value); setCourseId(""); setBatchId(""); setRoomId(""); }}>
          <option value="">Select branch</option>{options.branches.map(b =>
          <option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
        <label className="text-sm font-semibold">Class<select className={input} value={courseId}
          onChange={e => { setCourseId(e.target.value); setBatchId(""); }} disabled={!branchId}>
          <option value="">Select class</option>{courses.map(c =>
          <option value={c.id} key={c.id}>{c.title}</option>)}</select></label>
        <label className="text-sm font-semibold">Section<select className={input} value={batchId}
          onChange={e => setBatchId(e.target.value)} disabled={!courseId}>
          <option value="">Select section</option>{sections.map(s =>
          <option value={s.id} key={s.id}>{s.name} · {s.academicSession}</option>)}</select></label>
      </div>
      {section ? <>
        <nav aria-label="Weekday" className="mt-5 flex flex-wrap gap-2">
          {DAYS.map(d => <button type="button" key={d} aria-pressed={day === d} onClick={() => setDay(d)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${day === d ? "bg-brand-700 text-white" : ""}`}>
            {d.slice(0,3)}</button>)}
        </nav>
        <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">
          <b>Assembly, Lunch, Recess:</b> configure labelled BREAK slots at{" "}
          <a target="_blank" rel="noopener noreferrer" className="underline" href="/admin/academic-operations">Academic Operations → Periods</a>.
          These slots appear without invented subjects or teachers. For PT, Music, Art, Library and other taught activities, allocate the corresponding subject to a teacher.
        </p>
        <label className="mt-4 block text-sm font-semibold">Default classroom
          <select className={input} value={roomId}
            onChange={e => { setRoomId(e.target.value); setPreview(null); }}>
            <option value="">Choose classroom</option>{rooms.map(r =>
            <option value={r.id} key={r.id}>{r.name}</option>)}</select>
        </label>
        {loading ? <p className="py-10 text-center">Loading timetable…</p> : slots.length ?
          <SchoolClassDayGrid slots={slots} existing={existing} allocations={allocations} rooms={rooms}
            defaultRoom={roomId} draft={draft} onChange={change}/> :
          <p className="mt-4 rounded-xl border p-8 text-sm">No active bell periods for {day}. Configure teaching and break periods in Academic Operations first.</p>}
        {!rooms.length && !loading && <p className="mt-3 text-sm text-amber-800">Add an active classroom to this branch before scheduling lessons.</p>}
        {!allocations.length && !loading && <p className="mt-3 text-sm text-amber-800">Allocate subjects to teachers before scheduling lessons.</p>}
        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm">{notice}</p>}
        {preview && <section className="mt-4 rounded-xl border p-4 text-sm">
          <b>Preview: {preview.count} teaching period(s)</b>
          {preview.conflicts.length ? <ul className="mt-2 list-disc pl-5 text-red-700">{preview.conflicts.map((item,i) =>
            <li key={i}>Period {item.periodNumber}: {item.message}</li>)}</ul> :
            <p className="text-emerald-700">No conflicts detected.</p>}
          {preview.warnings.map((warning,i) => <p key={i} className="mt-2 text-amber-700">{warning}</p>)}
        </section>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm text-slate-500">{planned.length} new periods selected · Existing lessons are read-only here.</p>
          <div className="flex gap-2">
            <button type="button" className="rounded-xl border px-4 py-2" onClick={onClose}>Close</button>
            <button type="button" className="rounded-xl border px-4 py-2 font-bold" disabled={!planned.length || saving || loading}
              onClick={() => void submit("preview")}>Preview day</button>
            <button type="button" className="rounded-xl bg-brand-700 px-4 py-2 font-bold text-white"
              disabled={!preview || !!preview.conflicts.length || saving || loading}
              onClick={() => void submit("save")}>{saving ? "Working…" : "Save day"}</button>
          </div>
        </div>
      </> : <p className="mt-6 text-sm text-slate-500">Select a branch, class and section to begin.</p>}
    </div>
  </div>;
}
