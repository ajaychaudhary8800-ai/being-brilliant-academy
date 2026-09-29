"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { errorMessage, getAccessToken } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const datasets = {
  EXECUTIVE: ["admissions.students", "admissions.enquiries", "admissions.converted", "finance.feeCollectedPaise", "finance.outstandingPaise", "attendance.rate", "examinations.averagePercentage", "teachers.count"],
  STUDENTS: ["name", "branchId", "riskLevel", "performanceScore", "attendanceRate", "predictedPercentage"],
  TEACHERS: ["name", "branchId", "performanceScore", "workloadScore", "completionScore"],
  FINANCE: ["branchId", "feeDemandPaise", "feeCollectedPaise", "outstandingPaise"],
  ADMISSIONS: ["source", "total", "converted"],
  BRANCHES: ["name", "students", "teachers", "enquiries", "fees"],
} as const;
type Dataset = keyof typeof datasets;
type SavedReport = { id: string; name: string; dataset: Dataset; columns: string[] };
type Schedule = { id: string; frequency: string; format: string; recipients: string[]; nextRunAt: string; lastRunAt: string | null; lastStatus: string | null; active: boolean };
type DeliveryHistory = {
  id: string;
  createdAt: string;
  metadata: {
    trigger?: string;
    status?: string;
    recipientResults?: Array<{ recipient: string; status: string; error?: string; messageId?: string }>;
  } | null;
};

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${getAccessToken()}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? "Report request failed");
  }
  return response;
}

export function AnalyticsSavedReports() {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [name, setName] = useState("");
  const [dataset, setDataset] = useState<Dataset>("EXECUTIVE");
  const [columns, setColumns] = useState<string[]>([...datasets.EXECUTIVE]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedReport, setSelectedReport] = useState<SavedReport | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [frequency, setFrequency] = useState("WEEKLY");
  const [recipient, setRecipient] = useState("");
  const [format, setFormat] = useState("CSV");
  const [firstRun, setFirstRun] = useState("");
  const [historyFor, setHistoryFor] = useState("");
  const [deliveryHistory, setDeliveryHistory] = useState<DeliveryHistory[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await request("/analytics/reports?page=1&limit=100");
      setReports((await response.json()).data ?? []);
    } catch (cause) { setError(errorMessage(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (name.trim().length < 2 || !columns.length || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request("/analytics/reports", { method: "POST", body: JSON.stringify({ name: name.trim(), dataset, columns, groupBy: [], visualization: "TABLE", visibility: "PRIVATE" }) });
      setName(""); setNotice("Report saved."); await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function download(report: SavedReport, format: "csv" | "excel" | "pdf") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await request(`/analytics/reports/${report.id}/export?format=${format}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${report.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 70) || "report"}.${format === "excel" ? "xml" : format}`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function remove(report: SavedReport) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await request(`/analytics/reports/${report.id}`, { method: "DELETE" }); setNotice("Report archived."); await load(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function loadSchedules(report: SavedReport) {
    setError("");
    try { setSchedules((await (await request(`/analytics/reports/${report.id}/schedules`)).json()).data ?? []); setSelectedReport(report); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  async function scheduleReport() {
    if (!selectedReport || busy || !firstRun || !recipient.trim()) return;
    const date = new Date(firstRun);
    if (!Number.isFinite(date.getTime()) || date <= new Date()) { setError("Choose a future date and time."); return; }
    const cronExpression = `${date.getMinutes()} ${date.getHours()} ${frequency === "MONTHLY" ? date.getDate() : "*"} * ${frequency === "WEEKLY" ? date.getDay() : "*"}`;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(`/analytics/reports/${selectedReport.id}/schedules`, { method: "POST", body: JSON.stringify({ frequency, cronExpression, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, format, recipients: [recipient.trim()], nextRunAt: date.toISOString() }) });
      setNotice("Delivery scheduled."); await loadSchedules(selectedReport);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function toggleSchedule(schedule: Schedule) {
    if (!selectedReport || busy) return;
    setBusy(true); setError("");
    try { await request(`/analytics/reports/${selectedReport.id}/schedules/${schedule.id}`, { method: "PATCH", body: JSON.stringify({ active: !schedule.active }) }); await loadSchedules(selectedReport); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function loadHistory(schedule: Schedule) {
    if (!selectedReport) return;
    setError("");
    try {
      const response = await request(`/analytics/reports/${selectedReport.id}/schedules/${schedule.id}/history`);
      setDeliveryHistory((await response.json()).data ?? []);
      setHistoryFor(schedule.id);
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function runSchedule(schedule: Schedule, action: "run" | "retry") {
    if (!selectedReport || busy || schedule.lastStatus === "PROCESSING") return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await request(`/analytics/reports/${selectedReport.id}/schedules/${schedule.id}/${action}`, { method: "POST" });
      const outcome = (await response.json()).data;
      setNotice(`${action === "retry" ? "Retry" : "Delivery"} finished: ${outcome.status}.`);
      await loadSchedules(selectedReport);
      if (historyFor === schedule.id) await loadHistory(schedule);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <section className="mt-6 card p-5" aria-label="Saved analytics reports">
    <h2 className="text-lg font-semibold">Saved reports</h2>
    <p className="mt-1 text-sm text-slate-500">Choose a dataset and columns, save the report, then download current ERP data.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <label className="flex-1 text-sm">Report name<input className="field mt-1 w-full" maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="Monthly academy overview" /></label>
      <label className="min-w-44 text-sm">Dataset<select className="field mt-1 w-full" value={dataset} onChange={event => { const next = event.target.value as Dataset; setDataset(next); setColumns([...datasets[next]]); }}>{Object.keys(datasets).map(value => <option key={value} value={value}>{value[0] + value.slice(1).toLowerCase()}</option>)}</select></label>
    </div>
    <fieldset className="mt-4"><legend className="text-sm font-semibold">Columns</legend><div className="mt-2 flex flex-wrap gap-3">{datasets[dataset].map(column => <label key={column} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={columns.includes(column)} onChange={event => setColumns(current => event.target.checked ? [...current, column] : current.filter(value => value !== column))} />{column.replaceAll(".", " · ")}</label>)}</div></fieldset>
    <button className="mt-4 flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={busy || name.trim().length < 2 || columns.length === 0} onClick={() => void create()}><Plus size={16} />Save report</button>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-green-700">{notice}</p>}
    <div className="mt-5 divide-y dark:divide-slate-800">{reports.map(report => <div key={report.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><b>{report.name}</b><p className="text-xs text-slate-500">{report.dataset} · {report.columns.length} columns</p></div><div className="flex flex-wrap gap-2">{(["csv", "excel", "pdf"] as const).map(format => <button key={format} disabled={busy} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-sm disabled:opacity-50" onClick={() => void download(report, format)}><Download size={14} />{format === "excel" ? "Excel" : format.toUpperCase()}</button>)}<button className="rounded-lg border px-2 py-1 text-sm" onClick={() => void loadSchedules(report)}>Schedule</button><button title={`Archive ${report.name}`} aria-label={`Archive ${report.name}`} disabled={busy} className="rounded-lg border px-2 py-1 disabled:opacity-50" onClick={() => void remove(report)}><Trash2 size={14} /></button></div></div>)}{reports.length === 0 && <p className="py-4 text-sm text-slate-500">No saved reports yet.</p>}</div>
    {selectedReport && <div className="mt-5 rounded-xl border p-4"><h3 className="font-semibold">Schedule: {selectedReport.name}</h3><div className="mt-3 flex flex-wrap gap-3 text-sm"><label>First delivery<input type="datetime-local" className="field mt-1 block" value={firstRun} onChange={event => setFirstRun(event.target.value)} /></label><label>Frequency<select className="field mt-1 block" value={frequency} onChange={event => setFrequency(event.target.value)}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label><label>Format<select className="field mt-1 block" value={format} onChange={event => setFormat(event.target.value)}><option value="CSV">CSV</option><option value="EXCEL">Excel</option><option value="PDF">PDF preview</option></select></label><label className="min-w-52 flex-1">Recipient email<input type="email" className="field mt-1 w-full" value={recipient} onChange={event => setRecipient(event.target.value)} /></label></div><button disabled={busy || !firstRun || !recipient.trim()} className="mt-3 rounded-lg bg-brand-700 px-4 py-2 text-sm text-white disabled:opacity-50" onClick={() => void scheduleReport()}>Add delivery</button><div className="mt-4 divide-y">{schedules.map(schedule => <div key={schedule.id} className="py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span>{schedule.frequency.toLowerCase()} · {schedule.format} · {schedule.recipients.join(", ")} · Next {new Date(schedule.nextRunAt).toLocaleString()} · {schedule.lastStatus ?? "Not sent yet"}</span><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void toggleSchedule(schedule)} className="rounded-lg border px-2 py-1 disabled:opacity-50">{schedule.active ? "Pause" : "Resume"}</button><button disabled={busy || schedule.lastStatus === "PROCESSING"} onClick={() => void runSchedule(schedule, "run")} className="rounded-lg border px-2 py-1 disabled:opacity-50">Run now</button>{(schedule.lastStatus === "FAILED" || schedule.lastStatus === "PARTIAL") && <button disabled={busy} onClick={() => void runSchedule(schedule, "retry")} className="rounded-lg border px-2 py-1 disabled:opacity-50">Retry failed</button>}<button disabled={busy} onClick={() => void loadHistory(schedule)} className="rounded-lg border px-2 py-1 disabled:opacity-50">History</button></div></div>{historyFor === schedule.id && <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900"><b>Delivery history</b>{deliveryHistory.length === 0 && <p className="mt-1 text-slate-500">No delivery attempts recorded yet.</p>}{deliveryHistory.map(item => <div key={item.id} className="mt-2 border-t pt-2 first:border-t-0 first:pt-0"><div>{new Date(item.createdAt).toLocaleString()} · {item.metadata?.trigger ?? "UNKNOWN"} · {item.metadata?.status ?? "UNKNOWN"}</div>{item.metadata?.recipientResults?.map(result => <div key={`${item.id}-${result.recipient}`} className="text-slate-500">{result.recipient} — {result.status}{result.error ? ` · ${result.error}` : ""}</div>)}</div>)}</div>}</div>)}</div></div>}
    <p className="mt-3 text-xs text-slate-500">PDF shows a short preview. Choose CSV or Excel for complete rows and names in other scripts.</p>
  </section>;
}
