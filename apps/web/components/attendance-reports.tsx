"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { getAccessToken } from "./auth-provider";

type Mode = "student" | "teacher";
type Option = { id: string; name: string };
type ReportRow = { id: string; name: string; identifier: string | null; branch: string | null; course?: string | null; batch?: string | null; present: number; absent: number; late: number; fullDayLeave: number; halfDayLeave: number; shortLeave: number; leave: number; excused: number; total: number; percentage: number };
type ReportTotals = { present: number; absent: number; late: number; fullDayLeave: number; halfDayLeave: number; shortLeave: number; leave: number; excused: number; total: number; averagePercentage: number };
type Report = { mode: Mode; period: { from: string; to: string }; summary: ReportRow[]; totals: ReportTotals; recordCount: number };

const statuses = [["", "All statuses"], ["PRESENT", "Present"], ["ABSENT", "Absent"], ["LATE", "Late"], ["FULL_DAY_LEAVE", "Full-Day Leave"], ["HALF_DAY_LEAVE", "Half-Day Leave"], ["SHORT_LEAVE", "Short Leave"], ["LEAVE", "Leave"], ["EXCUSED", "Excused"]];
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const today = new Date().toISOString().slice(0, 10);
const currentMonth = today.slice(0, 7);
const headers = () => ({ Authorization: `Bearer ${getAccessToken() ?? ""}` });

export default function AttendanceReports() {
  const [mode, setMode] = useState<Mode>("student");
  const [period, setPeriod] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(currentMonth);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [status, setStatus] = useState("");
  const [branches, setBranches] = useState<Option[]>([]);
  const [courses, setCourses] = useState<Option[]>([]);
  const [batches, setBatches] = useState<Option[]>([]);
  const [students, setStudents] = useState<Option[]>([]);
  const [teachers, setTeachers] = useState<Option[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all(["branches?limit=100", "courses?limit=100", "batches?limit=100", "students?limit=100", "teachers?limit=100"].map(path => fetch(`${api}/admin/${path}`, { headers: headers() }).then(response => response.ok ? response.json() : { data: [] }))).then(([branch, course, batch, student, teacher]) => {
      setBranches((branch.data ?? []).map((item: any) => ({ id: item.id, name: item.name ?? item.branchName })));
      setCourses((course.data ?? []).map((item: any) => ({ id: item.id, name: item.title ?? item.name })));
      setBatches((batch.data ?? []).map((item: any) => ({ id: item.id, name: item.name })));
      setStudents((student.data ?? []).map((item: any) => ({ id: item.user?.id ?? item.id, name: item.user?.name ?? item.name })));
      setTeachers((teacher.data ?? []).map((item: any) => ({ id: item.id, name: item.user?.name ?? item.name })));
    }).catch(() => setError("Unable to load report filters."));
  }, []);

  const query = useMemo(() => {
    const value = new URLSearchParams({ mode });
    if (period === "month") value.set("month", month); else { value.set("from", from); value.set("to", to); }
    for (const [key, item] of Object.entries({ branchId, courseId: mode === "student" ? courseId : "", batchId: mode === "student" ? batchId : "", studentId: mode === "student" ? studentId : "", teacherId: mode === "teacher" ? teacherId : "", status })) if (item) value.set(key, item);
    return value;
  }, [mode, period, month, from, to, branchId, courseId, batchId, studentId, teacherId, status]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await fetch(`${api}/attendance/reports?${query}`, { headers: headers() }); const json = await response.json().catch(() => null); if (!response.ok) throw new Error(json?.error?.message ?? "Unable to load attendance report."); setReport(json.data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load attendance report."); }
    finally { setLoading(false); }
  }, [query]);
  useEffect(() => { void load(); }, [load]);

  function switchMode(next: Mode) { setMode(next); setCourseId(""); setBatchId(""); setStudentId(""); setTeacherId(""); }
  async function exportReport(format: "pdf" | "excel") {
    setExporting(format); setError("");
    try { const response = await fetch(`${api}/attendance/reports/export?format=${format}&${query}`, { headers: headers() }); if (!response.ok) { const json = await response.json().catch(() => null); throw new Error(json?.error?.message ?? "Export failed."); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `attendance-${mode}-report.${format === "pdf" ? "pdf" : "xls"}`; link.click(); URL.revokeObjectURL(url); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Export failed."); }
    finally { setExporting(null); }
  }

  const rows = report?.summary ?? [];
  return <section className="mt-6 rounded-2xl border bg-white p-5 dark:bg-slate-900"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Attendance Reports</h2><p className="mt-1 text-sm text-slate-500">{mode === "student" ? "Student attendance" : "Teacher attendance"} · {report ? `${report.period.from} — ${report.period.to}` : "Select a period"}</p></div><div className="flex gap-2"><button type="button" disabled={loading || exporting !== null} onClick={() => void exportReport("pdf")} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-semibold">{exporting === "pdf" ? <Loader2 className="animate-spin" size={16}/> : <Download size={16}/>}PDF</button><button type="button" disabled={loading || exporting !== null} onClick={() => void exportReport("excel")} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-semibold">{exporting === "excel" ? <Loader2 className="animate-spin" size={16}/> : <Download size={16}/>}Excel</button></div></div>{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}<div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Attendance report type"><button type="button" role="tab" aria-selected={mode === "student"} onClick={() => switchMode("student")} className={`rounded-xl px-4 py-2 text-sm font-semibold ${mode === "student" ? "bg-brand-700 text-white" : "border"}`}>Student Attendance</button><button type="button" role="tab" aria-selected={mode === "teacher"} onClick={() => switchMode("teacher")} className={`rounded-xl px-4 py-2 text-sm font-semibold ${mode === "teacher" ? "bg-brand-700 text-white" : "border"}`}>Teacher Attendance</button></div><div className="mt-4 grid gap-3 md:grid-cols-3 lg:grid-cols-6"><select aria-label="Reporting period" value={period} onChange={event => setPeriod(event.target.value as typeof period)} className="rounded-lg border p-2"><option value="month">Month</option><option value="range">Date range</option></select>{period === "month" ? <input aria-label="Month" type="month" value={month} onChange={event => setMonth(event.target.value)} className="rounded-lg border p-2"/> : <><input aria-label="From date" type="date" value={from} onChange={event => setFrom(event.target.value)} className="rounded-lg border p-2"/><input aria-label="To date" type="date" value={to} onChange={event => setTo(event.target.value)} className="rounded-lg border p-2"/></>}<select aria-label="Branch" value={branchId} onChange={event => setBranchId(event.target.value)} className="rounded-lg border p-2"><option value="">All branches</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{mode === "student" ? <><select aria-label="Course" value={courseId} onChange={event => setCourseId(event.target.value)} className="rounded-lg border p-2"><option value="">All courses</option>{courses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Batch" value={batchId} onChange={event => setBatchId(event.target.value)} className="rounded-lg border p-2"><option value="">All batches</option>{batches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Student" value={studentId} onChange={event => setStudentId(event.target.value)} className="rounded-lg border p-2"><option value="">All students</option>{students.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></> : <select aria-label="Teacher" value={teacherId} onChange={event => setTeacherId(event.target.value)} className="rounded-lg border p-2"><option value="">All teachers</option>{teachers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<select aria-label="Attendance status" value={status} onChange={event => setStatus(event.target.value)} className="rounded-lg border p-2">{statuses.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select><button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{loading ? "Loading…" : "Apply filters"}</button></div>{report && <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[["People", rows.length], ["Present", report.totals.present], ["Absent", report.totals.absent], ["Leave", report.totals.fullDayLeave + report.totals.halfDayLeave + report.totals.shortLeave + report.totals.leave + report.totals.excused], ["Average attendance", `${report.totals.averagePercentage}%`]].map(([label, value]) => <div key={label} className="rounded-xl border p-3"><p className="text-xs uppercase text-slate-400">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>)}</div>}<div className="mt-5 overflow-x-auto">{loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="animate-spin"/></div> : rows.length ? <table className="w-full min-w-[1000px] text-left text-sm"><thead><tr className="border-b">{[mode === "student" ? "Student" : "Teacher", mode === "student" ? "Admission No." : "Employee No.", "Branch", ...(mode === "student" ? ["Course", "Batch"] : []), "Present", "Absent", "Full-Day Leave", "Half-Day Leave", "Late", "Short Leave", "Attendance Days", "Attendance %"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b"><td className="p-2 font-semibold">{row.name}</td><td className="p-2">{row.identifier ?? "—"}</td><td className="p-2">{row.branch ?? "—"}</td>{mode === "student" && <><td className="p-2">{row.course ?? "—"}</td><td className="p-2">{row.batch ?? "—"}</td></>}<td className="p-2">{row.present}</td><td className="p-2">{row.absent}</td><td className="p-2">{row.fullDayLeave}</td><td className="p-2">{row.halfDayLeave}</td><td className="p-2">{row.late}</td><td className="p-2">{row.shortLeave}</td><td className="p-2">{row.total}</td><td className="p-2">{row.percentage}%</td></tr>)}</tbody></table> : <div className="rounded-xl border border-dashed p-10 text-center text-slate-500">No attendance records match the selected filters.</div>}</div></section>;
}
