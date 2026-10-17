"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { getAccessToken } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
type Day = (typeof DAYS)[number];
type TimeSlot = { periodNumber: number; startTime: string; endTime: string };
type ConfiguredPeriod = { id: string; periodNumber: number; startMinute: number; endMinute: number; type: string; isActive: boolean };
type Options = { branches: any[]; batches: any[]; teachers: any[]; classrooms: any[] };
type Conflict = { day: Day; code: string; message: string };
type PlannedEntry = { day: Day; periodNumber: number; startTime: string; endTime: string };
type Preview = { entries: PlannedEntry[]; count: number; conflicts: Conflict[]; warnings: string[]; weeklyAllocation: number | null; existingScheduled: number };
const DEFAULT_SLOT: TimeSlot = { periodNumber: 1, startTime: "09:00", endTime: "10:00" };
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });
async function json(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Error(body?.error?.message ?? "Request failed");
  return body;
}

export default function WeeklyTimetableDialog({ options, onClose, onSaved }: {
  options: Options; onClose: () => void; onSaved: (count: number) => Promise<void>;
}) {
  const [branchId, setBranch] = useState("");
  const [courseId, setCourse] = useState("");
  const [batchId, setBatch] = useState("");
  const [teacherId, setTeacher] = useState("");
  const [subjectId, setSubject] = useState("");
  const [classroomId, setClassroom] = useState("");
  const [selectedDays, setSelectedDays] = useState<Day[]>(DAYS.slice(0, 6) as Day[]);
  const [slots, setSlots] = useState<Record<Day, TimeSlot>>({} as Record<Day, TimeSlot>);
  const [configured, setConfigured] = useState<Partial<Record<Day, ConfiguredPeriod[]>>>({});
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [remarks, setRemarks] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const batch = options.batches.find(item => item.id === batchId);
  const academicSession = batch?.academicSession ?? "";
  const academicSessionId = batch?.academicSessionId ?? "";
  const courses = useMemo(() => Array.from(
    new Map(options.batches.filter(item => item.branchId === branchId)
      .map(item => [item.courseId, { id: item.courseId, name: item.course?.title ?? item.courseId }])).values(),
  ), [branchId, options.batches]);
  const batches = options.batches.filter(item => item.branchId === branchId && item.courseId === courseId);
  const teachers = options.teachers.filter(item => item.branchId === branchId);
  const rooms = options.classrooms.filter(item => item.branchId === branchId);
  const sortedDays = DAYS.filter(day => selectedDays.includes(day));

  function invalidate() { setPreview(null); setError(""); }
  function changeDay(day: Day, on: boolean) {
    invalidate();
    setSelectedDays(current => on ? [...current.filter(value => value !== day), day] : current.filter(value => value !== day));
  }
  function updateSlot(day: Day, patch: Partial<TimeSlot>) {
    invalidate();
    setSlots(current => ({ ...current, [day]: { ...(current[day] ?? DEFAULT_SLOT), ...patch } }));
  }
  function preset(days: readonly Day[]) {
    invalidate();
    setSelectedDays([...days]);
  }

  // A teacher can be assigned only subjects authorized for this group and session.
  useEffect(() => {
    if (!branchId || !courseId || !batchId || !teacherId || !academicSession) {
      setSubjects([]);
      setSubject("");
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ branchId, courseId, batchId, teacherId, academicSession });
    fetch(`${API}/admin/subject-options?${params}`, { headers: headers(), signal: controller.signal })
      .then(json).then(result => {
        const available = (result.data ?? []).map((item: { id: string; name: string }) => ({ id: item.id, name: item.name }));
        setSubjects(available);
        setSubject(current => available.some((item: { id: string }) => item.id === current) ? current : "");
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Cannot load allocated subjects"); });
    return () => controller.abort();
  }, [branchId, courseId, batchId, teacherId, academicSession]);

  // Every selected day can use a different bell period/time.
  useEffect(() => {
    if (!branchId || !academicSessionId || !selectedDays.length) {
      setConfigured({});
      return;
    }
    const controller = new AbortController();
    Promise.all(DAYS.filter(day => selectedDays.includes(day)).map(async day => {
      const params = new URLSearchParams({ branchId, academicSessionId, day });
      const result = await fetch(`${API}/admin/timetable-periods?${params}`, { headers: headers(), signal: controller.signal }).then(json);
      return [day, (result.data ?? []).filter((row: ConfiguredPeriod) => row.isActive && row.type === "TEACHING")] as const;
    })).then(rows => {
      if (controller.signal.aborted) return;
      const settings = Object.fromEntries(rows) as Partial<Record<Day, ConfiguredPeriod[]>>;
      setConfigured(settings);
      setSlots(current => {
        const next = { ...current };
        for (const [day, list] of rows) {
          if (!list.length) continue;
          const match = list.find(row => row.periodNumber === current[day]?.periodNumber) ?? list[0];
          next[day] = { periodNumber: match.periodNumber, startTime: clock(match.startMinute), endTime: clock(match.endMinute) };
        }
        return next;
      });
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Cannot load configured bell periods"); });
    return () => controller.abort();
  }, [branchId, academicSessionId, selectedDays]);

  const entries = sortedDays.map(day => ({ branchId, courseId, batchId, teacherId, subjectId, classroomId,
    academicSession, day, ...(slots[day] ?? DEFAULT_SLOT), remarks: remarks.trim() || null, status }));
  const ready = Boolean(branchId && courseId && batchId && teacherId && subjectId && classroomId && academicSession
    && sortedDays.length && sortedDays.every(day => {
      const slot = slots[day] ?? DEFAULT_SLOT;
      return Number.isInteger(slot.periodNumber) && slot.periodNumber >= 1 && slot.periodNumber <= 50 &&
        slot.startTime < slot.endTime && /^\d\d:\d\d$/.test(slot.startTime) && /^\d\d:\d\d$/.test(slot.endTime);
    }));

  async function requestPreview(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const result = await fetch(`${API}/admin/timetables/weekly/preview`, {
        method: "POST", headers: headers(), body: JSON.stringify({ entries }),
      }).then(json);
      setPreview(result.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview failed"); }
    finally { setSaving(false); }
  }
  async function save() {
    if (!preview || preview.conflicts.length || !ready) return;
    setSaving(true); setError("");
    try {
      const result = await fetch(`${API}/admin/timetables/weekly`, {
        method: "POST", headers: headers(), body: JSON.stringify({ entries }),
      }).then(json);
      await onSaved(result.meta.created);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Weekly schedule could not be saved"); }
    finally { setSaving(false); }
  }

  return <div role="dialog" aria-modal="true" aria-label="Add weekly timetable" className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4 print:hidden">
    <form onSubmit={requestPreview} className="mx-auto my-6 w-full max-w-5xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-xl font-bold">Add Weekly Schedule</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Create one regular period on multiple weekdays in one operation. Preview checks every day before saving.</p></div>
        <button type="button" onClick={onClose} aria-label="Close weekly schedule" className="rounded-lg p-1 hover:bg-slate-100"><X /></button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-semibold">Branch
          <select required className="field" value={branchId} onChange={event => {
            setBranch(event.target.value); setCourse(""); setBatch(""); setTeacher(""); setSubject(""); setClassroom(""); setSlots({} as Record<Day, TimeSlot>); invalidate();
          }}><option value="">Select branch</option>{options.branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </label>
        <label className="text-sm font-semibold">Class / Course
          <select required className="field" value={courseId} onChange={event => { setCourse(event.target.value); setBatch(""); setSubject(""); invalidate(); }}>
            <option value="">Select class</option>{courses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Section / Batch
          <select required className="field" value={batchId} onChange={event => { setBatch(event.target.value); setSubject(""); setSlots({} as Record<Day, TimeSlot>); invalidate(); }}>
            <option value="">Select section</option>{batches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Teacher
          <select required className="field" value={teacherId} onChange={event => { setTeacher(event.target.value); setSubject(""); invalidate(); }}>
            <option value="">Select teacher</option>{teachers.map(item => <option key={item.id} value={item.id}>{item.user.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Subject
          <select required className="field" value={subjectId} onChange={event => { setSubject(event.target.value); invalidate(); }}>
            <option value="">Select allocated subject</option>{subjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {teacherId && batchId && !subjects.length && <span className="mt-1 block text-xs text-amber-700">No allocated subjects found. Complete Teacher Allocation first.</span>}
        </label>
        <label className="text-sm font-semibold">Classroom
          <select required className="field" value={classroomId} onChange={event => { setClassroom(event.target.value); invalidate(); }}>
            <option value="">Select classroom</option>{rooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Academic Session
          <input readOnly className="field" value={academicSession || "Select a section first"} />
        </label>
        <label className="text-sm font-semibold">Status
          <select className="field" value={status} onChange={event => { setStatus(event.target.value); invalidate(); }}>
            <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
          </select>
        </label>
      </div>
      <fieldset className="mt-6 rounded-xl border p-4">
        <legend className="px-1 text-sm font-bold">Repeat on weekdays</legend>
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => preset(DAYS.slice(0, 6))} className="rounded-lg border px-3 py-2 text-sm font-semibold">Mon–Sat (6 days)</button>
          <button type="button" onClick={() => preset(DAYS.slice(0, 5))} className="rounded-lg border px-3 py-2 text-sm font-semibold">Mon–Fri (5 days)</button>
          <button type="button" onClick={() => preset(DAYS)} className="rounded-lg border px-3 py-2 text-sm font-semibold">All 7 days</button>
          <button type="button" onClick={() => preset([])} className="rounded-lg border px-3 py-2 text-sm font-semibold">Clear</button>
        </div>
        <div className="flex flex-wrap gap-3">
          {DAYS.map(day => <label key={day} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <input type="checkbox" checked={selectedDays.includes(day)} onChange={event => changeDay(day, event.target.checked)} />
            {day.slice(0, 3)}
          </label>)}
        </div>
        <p className="mt-2 text-xs text-slate-500">Choose individual days for GK (Mon/Wed), Computer (Tue/Thu), or other non-daily lessons.</p>
      </fieldset>
      <section className="mt-5">
        <h3 className="font-bold">Period and time for each selected day</h3>
        <p className="mt-1 text-xs text-slate-500">Use configured school teaching periods when available. Different weekdays may have different timings.</p>
        {!sortedDays.length && <p className="mt-2 text-sm text-red-700">Select at least one day.</p>}
        <div className="mt-3 space-y-3">
          {sortedDays.map(day => {
            const list = configured[day] ?? [];
            const slot = slots[day] ?? DEFAULT_SLOT;
            return <div key={day} className="grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-4">
              <strong className="pb-2 text-sm">{day}</strong>
              {list.length ? <label className="text-xs font-semibold sm:col-span-3">Configured teaching period
                <select className="field" value={slot.periodNumber} onChange={event => {
                  const row = list.find(item => item.periodNumber === Number(event.target.value));
                  if (row) updateSlot(day, { periodNumber: row.periodNumber, startTime: clock(row.startMinute), endTime: clock(row.endMinute) });
                }}>{list.map(row => <option key={row.id} value={row.periodNumber}>Period {row.periodNumber} · {clock(row.startMinute)}–{clock(row.endMinute)}</option>)}</select>
              </label> : <>
                <label className="text-xs font-semibold">Period number
                  <input required type="number" min={1} max={50} className="field" value={slot.periodNumber}
                    onChange={event => updateSlot(day, { periodNumber: Number(event.target.value) })} />
                </label>
                <label className="text-xs font-semibold">Start time
                  <input required type="time" className="field" value={slot.startTime} onChange={event => updateSlot(day, { startTime: event.target.value })} />
                </label>
                <label className="text-xs font-semibold">End time
                  <input required type="time" className="field" value={slot.endTime} onChange={event => updateSlot(day, { endTime: event.target.value })} />
                </label>
              </>}
            </div>;
          })}
        </div>
      </section>
      <label className="mt-5 block text-sm font-semibold">Remarks (optional)
        <textarea maxLength={2000} className="field min-h-20" value={remarks} onChange={event => { setRemarks(event.target.value); invalidate(); }} />
      </label>
      {preview && <section className="mt-5 rounded-xl border bg-slate-50 p-4 dark:bg-slate-800" aria-live="polite">
        <h3 className="font-bold">Preview: {preview.count} weekly timetable entries</h3>
        <div className="mt-3 space-y-2 text-sm">
          {preview.entries.map(row => {
            const conflict = preview.conflicts.find(issue => issue.day === row.day);
            return <div key={row.day} className="flex flex-wrap justify-between gap-2 border-b pb-2">
              <span><b>{row.day}</b> · Period {row.periodNumber} · {row.startTime}–{row.endTime}</span>
              <span className={conflict ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>
                {conflict ? `Conflict: ${conflict.message}` : "Available"}
              </span>
            </div>;
          })}
        </div>
        {preview.conflicts.length > 0 && <p role="alert" className="mt-3 font-semibold text-red-700">{preview.conflicts.length} conflict(s). Fix the schedule and preview again; no periods will be saved until every day is valid.</p>}
        {preview.warnings.map(warning => <p role="note" key={warning} className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>)}
      </section>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-lg border px-5 py-3 font-semibold">Cancel</button>
        {preview ? <button type="button" disabled={saving || !!preview.conflicts.length || !ready} onClick={() => void save()}
          className="rounded-lg bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-40">
          {saving && <Loader2 size={16} className="mr-2 inline animate-spin" />}Save All {preview.count} Periods
        </button> : <button type="submit" disabled={saving || !ready}
          className="rounded-lg bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-40">
          {saving && <Loader2 size={16} className="mr-2 inline animate-spin" />}Preview {sortedDays.length} Periods
        </button>}
      </div>
    </form>
  </div>;
}
