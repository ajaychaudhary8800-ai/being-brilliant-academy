"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Clock3, Plus, RefreshCw, UserRoundCheck, Users } from "lucide-react";
import { AuthGate, getAccessToken } from "../../../components/auth-provider";
import Sidebar from "../../../components/sidebar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });

async function json(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "Request failed");
  return body;
}

type Option = { id: string; name: string };
type Period = { periodNumber: number; startTime: string; endTime: string; type: "TEACHING" | "BREAK"; label: string; isActive: boolean };
type Tab = "workload" | "substitutions" | "periods";

const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const blankPeriod = (number: number): Period => ({ periodNumber: number, startTime: "09:00", endTime: "09:45", type: "TEACHING", label: "", isActive: true });

function clock(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function pretty(value: string) {
  return value.replaceAll(/([A-Z])/g, " $1").replaceAll("_", " ").trim().replace(/\b\w/g, c => c.toUpperCase());
}

function Content() {
  const today = new Date().toISOString().slice(0, 10);
  const [tab, setTab] = useState<Tab>("workload");
  const [branches, setBranches] = useState<Option[]>([]);
  const [sessions, setSessions] = useState<Option[]>([]);
  const [teachers, setTeachers] = useState<Array<Option & { branchId: string }>>([]);
  const [timetables, setTimetables] = useState<any[]>([]);
  const [branchId, setBranchId] = useState("");
  const [academicSessionId, setAcademicSessionId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [date, setDate] = useState(today);
  const [workload, setWorkload] = useState<any>(null);
  const [substitutions, setSubstitutions] = useState<any[]>([]);
  const [timetableId, setTimetableId] = useState("");
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [day, setDay] = useState("MONDAY");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`${API}/admin/branches?limit=100&status=active`, { headers: headers() }).then(json),
      fetch(`${API}/admin/academic-sessions?limit=100&status=active`, { headers: headers() }).then(json),
      fetch(`${API}/admin/teachers?limit=100&status=active`, { headers: headers() }).then(json),
      fetch(`${API}/admin/timetables?limit=100&status=ACTIVE`, { headers: headers() }).then(json),
    ]).then(([branchData, sessionData, teacherData, timetableData]) => {
      setBranches((branchData.data ?? []).map((row: any) => ({ id: row.id, name: row.name ?? row.branchName })));
      setSessions(sessionData.data ?? []);
      setTeachers((teacherData.data ?? []).map((row: any) => ({ id: row.id, name: `${row.user.name} (${row.employeeNo})`, branchId: row.branch.id })));
      setTimetables(timetableData.data ?? []);
    }).catch(cause => setError(cause.message));
  }, []);

  const loadSubstitutions = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: "1", limit: "100" });
      if (branchId) params.set("branchId", branchId);
      const result = await fetch(`${API}/admin/substitutions?${params}`, { headers: headers() }).then(json);
      setSubstitutions(result.data ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load substitutions");
    }
  }, [branchId]);

  useEffect(() => { if (tab === "substitutions") void loadSubstitutions(); }, [tab, loadSubstitutions]);

  async function loadWorkload() {
    if (!branchId || !academicSessionId || !teacherId) return;
    setLoading(true);
    try {
      setWorkload((await fetch(`${API}/admin/teacher-workload?${new URLSearchParams({ branchId, academicSessionId, teacherId, date })}`, { headers: headers() }).then(json)).data);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to calculate workload");
    } finally {
      setLoading(false);
    }
  }

  async function findCandidates() {
    try {
      const result = await fetch(`${API}/admin/substitutions/candidates?${new URLSearchParams({ timetableId, date })}`, { headers: headers() }).then(json);
      setCandidates(result.data);
      setCandidateId("");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to find substitutes");
    }
  }

  async function assign(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await fetch(`${API}/admin/substitutions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ timetableId, date, substituteTeacherId: candidateId, reason: "Approved leave coverage" }),
      }).then(json);
      setNotice(`Substitution assigned.${result.meta?.warning ? ` ${result.meta.warning}` : ""}`);
      setCandidates([]);
      setCandidateId("");
      setTimetableId("");
      await loadSubstitutions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to assign substitute");
    }
  }

  async function changeSubstitution(id: string, status: "COMPLETED" | "CANCELLED") {
    try {
      await fetch(`${API}/admin/substitutions/${id}/status`, { method: "PATCH", headers: headers(), body: JSON.stringify({ status }) }).then(json);
      setNotice(`Substitution marked ${status.toLowerCase()}.`);
      await loadSubstitutions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update substitution");
    }
  }

  async function loadPeriods() {
    if (!branchId || !academicSessionId) return;
    setLoading(true);
    try {
      const result = await fetch(`${API}/admin/timetable-periods?${new URLSearchParams({ branchId, academicSessionId, day })}`, { headers: headers() }).then(json);
      setPeriods(result.data.map((row: any) => ({ periodNumber: row.periodNumber, startTime: clock(row.startMinute), endTime: clock(row.endMinute), type: row.type, label: row.label ?? "", isActive: row.isActive })));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load periods");
    } finally {
      setLoading(false);
    }
  }

  async function savePeriods() {
    if (!branchId || !academicSessionId) return;
    setLoading(true);
    try {
      await fetch(`${API}/admin/timetable-periods`, { method: "PUT", headers: headers(), body: JSON.stringify({ branchId, academicSessionId, day, periods }) }).then(json);
      setNotice(`${pretty(day)} timetable periods saved.`);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save periods");
    } finally {
      setLoading(false);
    }
  }

  const scopedTeachers = teachers.filter(row => !branchId || row.branchId === branchId);
  const sessionName = sessions.find(session => session.id === academicSessionId)?.name;
  const scopedTimetables = timetables.filter(row => (!branchId || row.branch.id === branchId) && (!academicSessionId || row.academicSession === sessionName));
  const activeSubstitutions = substitutions.filter(row => row.status === "ASSIGNED").length;
  const teachingPeriods = periods.filter(row => row.type === "TEACHING" && row.isActive).length;
  const breakPeriods = periods.filter(row => row.type === "BREAK" && row.isActive).length;
  const workloadNumbers = useMemo(() => workload?.daily ? Object.entries(workload.daily).filter(([, value]) => typeof value === "number") : [], [workload]);

  return <div className="min-h-screen bg-slate-50">
    <Sidebar/>
    <main className="p-5 md:ml-64 md:p-10">
      <div className="mx-auto max-w-7xl">
        <header>
          <p className="text-sm font-bold text-brand-700">ACADEMICS</p>
          <h1 className="text-3xl font-bold">Academic Operations</h1>
          <p className="mt-1 text-sm text-slate-500">Teacher workload, free periods, substitution coverage and timetable period configuration in one operational workspace.</p>
        </header>

        <nav className="mt-6 flex flex-wrap gap-2">
          {[
            ["workload", "Teacher Workload"],
            ["substitutions", "Substitutions"],
            ["periods", "Period Configuration"],
          ].map(([key, label]) => <button key={key} onClick={() => { setTab(key as Tab); setError(""); setNotice(""); }} className={`rounded-xl px-4 py-2.5 font-semibold ${tab === key ? "bg-brand-700 text-white" : "border bg-white"}`}>{label}</button>)}
        </nav>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={<Users size={18}/>} label="Available teachers" value={scopedTeachers.length}/>
          <Metric icon={<CalendarClock size={18}/>} label="Active timetables" value={scopedTimetables.length}/>
          <Metric icon={<UserRoundCheck size={18}/>} label="Assigned substitutions" value={activeSubstitutions}/>
          <Metric icon={<Clock3 size={18}/>} label="Configured periods" value={periods.length}/>
        </section>

        {notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">{notice}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}

        <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Branch"><Select value={branchId} onChange={value => { setBranchId(value); setTeacherId(""); setWorkload(null); setPeriods([]); }} placeholder="Select branch" options={branches}/></Field>
            <Field label="Academic session"><Select value={academicSessionId} onChange={value => { setAcademicSessionId(value); setWorkload(null); setPeriods([]); }} placeholder="Select session" options={sessions}/></Field>
            {tab !== "periods" && <Field label="Teacher"><Select value={teacherId} onChange={setTeacherId} placeholder="Select teacher" options={scopedTeachers}/></Field>}
            {tab !== "periods" && <Field label={tab === "substitutions" ? "Coverage date" : "Workload date"}><input type="date" className="field" value={date} onChange={event => setDate(event.target.value)}/></Field>}
            {tab === "periods" && <Field label="Day"><select className="field" value={day} onChange={event => setDay(event.target.value)}>{days.map(value => <option key={value} value={value}>{pretty(value)}</option>)}</select></Field>}
          </div>
          <p className="mt-4 text-sm text-slate-500">
            {tab === "workload" ? "Select branch, session and teacher to calculate teaching load, free periods and slot states."
              : tab === "substitutions" ? "Choose the affected timetable period, rank available teachers, then confirm coverage."
                : "Load a day to edit period timings, teaching/break type, labels and active status."}
          </p>
        </section>

        {tab === "workload" && <section className="mt-5">
          <div className="flex flex-wrap gap-3">
            <button disabled={!branchId || !academicSessionId || !teacherId || loading} onClick={() => void loadWorkload()} className="btn bg-brand-700 text-white disabled:opacity-50">
              <RefreshCw size={17} className={loading ? "animate-spin" : ""}/>Calculate workload
            </button>
          </div>
          {!workload && <Empty title="No workload calculated yet" description="Select the required filters above and calculate to view teaching periods, free slots and workload warnings."/>}
          {workload && <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              {workloadNumbers.map(([key, value]) => <div className="rounded-xl border bg-white p-4 shadow-sm" key={key}><small className="font-semibold uppercase tracking-wide text-slate-400">{pretty(key)}</small><p className="mt-1 text-2xl font-bold">{String(value)}</p></div>)}
            </div>
            {workload.warnings?.map((warning: string) => <p key={warning} className="mt-3 rounded-xl bg-amber-50 p-3 text-amber-800">{warning}</p>)}
            <div className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="font-bold">Daily slot states</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {(workload.daily.states ?? []).map((row: any) => <div className="rounded-xl border p-3" key={row.periodNumber}><b>Period {row.periodNumber}</b><p className="mt-1 text-sm text-slate-500">{pretty(row.state)}</p></div>)}
              </div>
            </div>
          </>}
        </section>}

        {tab === "substitutions" && <section className="mt-5 space-y-5">
          <form onSubmit={assign} className="grid gap-4 rounded-2xl border bg-white p-5 shadow-sm md:grid-cols-3">
            <Field label="Affected timetable period" className="md:col-span-2"><select required className="field" value={timetableId} onChange={event => { setTimetableId(event.target.value); setCandidates([]); }}><option value="">Select timetable period</option>{scopedTimetables.map(row => <option key={row.id} value={row.id}>{row.day} P{row.periodNumber} · {row.batch.name} · {row.subject.name} · {row.teacher.user.name}</option>)}</select></Field>
            <div className="flex items-end"><button type="button" disabled={!timetableId || !date} onClick={() => void findCandidates()} className="btn w-full border disabled:opacity-50"><Users size={17}/>Find Substitute</button></div>
            {candidates.length > 0 && <>
              <Field label="Ranked substitute" className="md:col-span-2"><select required className="field" value={candidateId} onChange={event => setCandidateId(event.target.value)}><option value="">Select candidate</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.subjectQualified ? "subject qualified" : "subject mismatch"} · load {candidate.todayLoad}</option>)}</select></Field>
              <div className="flex items-end"><button disabled={!candidateId} className="btn w-full bg-brand-700 text-white disabled:opacity-50"><CheckCircle2 size={17}/>Confirm assignment</button></div>
            </>}
          </form>

          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between p-5"><div><h2 className="font-bold">Substitution history</h2><p className="text-sm text-slate-500">{substitutions.length} records in current branch scope</p></div><button className="btn border" onClick={() => void loadSubstitutions()}><RefreshCw size={16}/>Refresh</button></div>
            {substitutions.map(row => <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm" key={row.id}>
              <span><b>{row.date.slice(0, 10)} · Period {row.timetable.periodNumber}</b><br/><span className="text-slate-500">{row.originalTeacher.user.name} → {row.substituteTeacher.user.name} · {row.subject.name} · {row.batch.name}</span></span>
              <span className="flex items-center gap-2"><b>{pretty(row.status)}</b>{row.status === "ASSIGNED" && <><button className="rounded-lg border px-3 py-2 text-emerald-700" onClick={() => void changeSubstitution(row.id, "COMPLETED")}>Complete</button><button className="rounded-lg border px-3 py-2 text-red-600" onClick={() => void changeSubstitution(row.id, "CANCELLED")}>Cancel</button></>}</span>
            </div>)}
            {!substitutions.length && <Empty title="No substitutions found" description="No substitution assignments exist for the current branch scope." compact/>}
          </div>
        </section>}

        {tab === "periods" && <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={!branchId || !academicSessionId || loading} onClick={() => void loadPeriods()} className="btn border disabled:opacity-50"><CalendarClock size={17}/>{loading ? "Loading…" : "Load day"}</button>
            <button disabled={!branchId || !academicSessionId} onClick={() => setPeriods(value => [...value, blankPeriod(Math.max(0, ...value.map(row => row.periodNumber)) + 1)])} className="btn border disabled:opacity-50"><Plus size={17}/>Add period</button>
            <span className="text-sm text-slate-500">{teachingPeriods} teaching · {breakPeriods} break · {periods.length} total</span>
          </div>

          {!periods.length ? <Empty title="No periods loaded" description="Choose branch, session and day, then load the timetable periods or add the first period." compact/> :
          <div className="mt-5 space-y-3">
            {periods.map((period, index) => <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-[90px_1fr_1fr_1fr_1.3fr_100px_auto]" key={`${period.periodNumber}-${index}`}>
              <Field label="Period"><input aria-label="Period number" type="number" min="1" max="50" className="field" value={period.periodNumber} onChange={event => setPeriods(value => value.map((row, rowIndex) => rowIndex === index ? { ...row, periodNumber: Number(event.target.value) } : row))}/></Field>
              <Field label="Start"><input aria-label="Start time" type="time" className="field" value={period.startTime} onChange={event => setPeriods(value => value.map((row, rowIndex) => rowIndex === index ? { ...row, startTime: event.target.value } : row))}/></Field>
              <Field label="End"><input aria-label="End time" type="time" className="field" value={period.endTime} onChange={event => setPeriods(value => value.map((row, rowIndex) => rowIndex === index ? { ...row, endTime: event.target.value } : row))}/></Field>
              <Field label="Type"><select className="field" value={period.type} onChange={event => setPeriods(value => value.map((row, rowIndex) => rowIndex === index ? { ...row, type: event.target.value as Period["type"] } : row))}><option value="TEACHING">Teaching</option><option value="BREAK">Break</option></select></Field>
              <Field label="Label"><input className="field" placeholder="e.g. Lunch / Period 1" value={period.label} onChange={event => setPeriods(value => value.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row))}/></Field>
              <label className="flex items-end gap-2 pb-2 text-sm font-semibold"><input type="checkbox" checked={period.isActive} onChange={event => setPeriods(value => value.map((row, rowIndex) => rowIndex === index ? { ...row, isActive: event.target.checked } : row))}/>Active</label>
              <div className="flex items-end"><button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold text-red-600" onClick={() => setPeriods(value => value.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></div>
            </div>)}
          </div>}
          <button disabled={!branchId || !academicSessionId || !periods.length || loading} onClick={() => void savePeriods()} className="btn mt-5 bg-brand-700 text-white disabled:opacity-50">Save {pretty(day)} configuration</button>
        </section>}
      </div>
    </main>
    <style jsx global>{`
      .field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:white}
      .btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;border-radius:.75rem;padding:.65rem .95rem;font-size:.875rem;font-weight:700}
    `}</style>
  </div>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return <div className="rounded-2xl border bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-brand-700">{icon}<span className="text-xs font-bold uppercase tracking-wide">{label}</span></div><p className="mt-2 text-2xl font-bold">{value}</p></div>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`text-sm font-semibold ${className}`}><span className="mb-1 block text-slate-600">{label}</span>{children}</label>;
}

function Select({ value, onChange, placeholder, options }: { value: string; onChange: (value: string) => void; placeholder: string; options: Option[] }) {
  return <select className="field" value={value} onChange={event => onChange(event.target.value)}><option value="">{placeholder}</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>;
}

function Empty({ title, description, compact = false }: { title: string; description: string; compact?: boolean }) {
  return <div className={`${compact ? "my-5" : "mt-5"} rounded-2xl border border-dashed bg-white p-8 text-center`}><p className="font-bold text-slate-700">{title}</p><p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500">{description}</p></div>;
}

export default function Page() {
  return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><Content/></AuthGate>;
}
