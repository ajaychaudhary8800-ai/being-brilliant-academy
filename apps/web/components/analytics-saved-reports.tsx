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
    <div className="mt-5 divide-y dark:divide-slate-800">{reports.map(report => <div key={report.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><b>{report.name}</b><p className="text-xs text-slate-500">{report.dataset} · {report.columns.length} columns</p></div><div className="flex flex-wrap gap-2">{(["csv", "excel", "pdf"] as const).map(format => <button key={format} disabled={busy} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-sm disabled:opacity-50" onClick={() => void download(report, format)}><Download size={14} />{format === "excel" ? "Excel" : format.toUpperCase()}</button>)}<button title={`Archive ${report.name}`} aria-label={`Archive ${report.name}`} disabled={busy} className="rounded-lg border px-2 py-1 disabled:opacity-50" onClick={() => void remove(report)}><Trash2 size={14} /></button></div></div>)}{reports.length === 0 && <p className="py-4 text-sm text-slate-500">No saved reports yet.</p>}</div>
    <p className="mt-3 text-xs text-slate-500">PDF shows a short preview. Choose CSV or Excel for complete rows and names in other scripts.</p>
  </section>;
}
