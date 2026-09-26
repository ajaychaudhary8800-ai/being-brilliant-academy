"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, BrainCircuit, Building2, IndianRupee, RefreshCw, Send, TrendingUp, Users } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";
import { AnalyticsSavedReports } from "../../../components/analytics-saved-reports";
import { AnalyticsActionCenter } from "../../../components/analytics-action-center";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Row = Record<string, unknown>;
type Tab = "executive" | "students" | "teachers" | "finance" | "admissions" | "comparison";
const tabs: { id: Tab; label: string }[] = [
  { id: "executive", label: "Overview" },
  { id: "students", label: "Student progress" },
  { id: "teachers", label: "Faculty" },
  { id: "finance", label: "Finance" },
  { id: "admissions", label: "Admissions" },
  { id: "comparison", label: "Branches" },
];
const rupees = (paise: unknown) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(paise ?? 0) / 100);
const percent = (value: unknown) => `${Number(value ?? 0).toFixed(1)}%`;

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken()}`, ...init?.headers },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.message ?? "Unable to load analytics");
  return json;
}

function details(tab: Tab, data: any): { title: string; fields: [string, string][] }[] {
  if (tab === "executive") return [
    { title: "Admissions", fields: [["Students", String(data.admissions?.students ?? 0)], ["Enquiries", String(data.admissions?.enquiries ?? 0)], ["Converted", String(data.admissions?.converted ?? 0)], ["Conversion rate", percent(data.admissions?.conversionRate)]] },
    { title: "Fees", fields: [["Collected", rupees(data.finance?.feeCollectedPaise)], ["Outstanding", rupees(data.finance?.outstandingPaise)], ["Collection rate", percent(data.finance?.collectionRate)]] },
    { title: "Learning", fields: [["Attendance", percent(data.attendance?.rate)], ["Attendance records", String(data.attendance?.total ?? 0)], ["Exam average", percent(data.examinations?.averagePercentage)], ["Published results", String(data.examinations?.results ?? 0)]] },
    { title: "Faculty", fields: [["Teachers", String(data.teachers?.count ?? 0)], ["Homework assigned", String(data.teachers?.homeworks ?? 0)], ["Submissions", String(data.teachers?.submissions ?? 0)]] },
  ];
  if (tab === "admissions") return [
    { title: "Conversion", fields: [["Enquiries", String(data.total ?? 0)], ["Converted", String(data.converted ?? 0)], ["Conversion rate", percent(data.conversionRate)], ["30-day estimate", String(data.forecastNext30Days ?? 0)]] },
  ];
  if (tab === "finance") return [
    { title: "Fee outlook", fields: [["Outstanding", rupees(data.outstandingFeePaise)], ["Overdue accounts", String(data.outstandingRisk ?? 0)], ["Projected cash flow", rupees(data.cashFlowForecastPaise)]] },
    { title: "Forecast method", fields: [["Model", String(data.modelVersion ?? "Unavailable")], ["Revenue estimate", rupees(data.revenueForecast?.predictedValue)], ["Expense estimate", rupees(data.expenseForecast?.predictedValue)]] },
  ];
  return [];
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("executive");
  const [data, setData] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [meta, setMeta] = useState<{ total?: number; cached?: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [risk, setRisk] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; suggestedActions?: string[] } | null>(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const paths: Record<Tab, string> = {
        executive: `/analytics/executive${refresh ? "?refresh=true" : ""}`,
        students: `/analytics/students?page=${page}&limit=20${risk ? `&risk=${risk}` : ""}`,
        teachers: `/analytics/teachers?page=${page}&limit=20`,
        finance: "/analytics/finance",
        admissions: "/analytics/admissions",
        comparison: "/analytics/bi/comparison",
      };
      const results = await Promise.all([api(paths[tab]), ...(tab === "executive" ? [] : [api("/analytics/executive")])]);
      setData(results[0].data);
      setMeta(results[0].meta ?? null);
      if (tab === "executive") setOverview(results[0].data);
      else setOverview(results[1].data);
    } catch (e) {
      setData(null);
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [tab, page, risk]);

  useEffect(() => { void load(); }, [load]);

  async function ask() {
    if (!question.trim() || asking) return;
    setAsking(true);
    setError("");
    try {
      setAnswer((await api("/analytics/assistant", { method: "POST", body: JSON.stringify({ question: question.trim() }) })).data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAsking(false);
    }
  }

  const cards = [
    { icon: Users, label: "Students", value: String(overview?.admissions?.students ?? "—"), tab: "students" as Tab },
    { icon: IndianRupee, label: "Fees collected", value: overview ? rupees(overview.finance?.feeCollectedPaise) : "—", tab: "finance" as Tab },
    { icon: TrendingUp, label: "Attendance", value: overview ? percent(overview.attendance?.rate) : "—", tab: "executive" as Tab },
    { icon: BarChart3, label: "Exam average", value: overview ? percent(overview.examinations?.averagePercentage) : "—", tab: "executive" as Tab },
    { icon: Building2, label: "Enquiry conversion", value: overview ? percent(overview.admissions?.conversionRate) : "—", tab: "admissions" as Tab },
  ];
  const panels = data && !Array.isArray(data) ? details(tab, data) : [];
  const rows: Row[] = Array.isArray(data) ? data : [];

  return <ProtectedAdminWorkspace title="Intelligence & Analytics" description="Live ERP, LMS and admissions indicators with branch, student and faculty views.">
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map(({ icon: Icon, label, value, tab: target }) => <button key={label} className="card p-4 text-left" onClick={() => { setPage(1); setTab(target); }}>
        <Icon className="text-brand-700" size={20} /><p className="mt-3 text-xs uppercase text-slate-500">{label}</p><b className="mt-1 block text-xl">{value}</b>
      </button>)}
    </div>
    <div className="mt-6 flex flex-wrap items-center gap-2">
      {tabs.map(item => <button key={item.id} onClick={() => { setPage(1); setTab(item.id); }} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === item.id ? "bg-brand-700 text-white" : "border bg-white dark:bg-slate-900"}`}>{item.label}</button>)}
      <button onClick={() => void load(true)} disabled={loading} className="ml-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={16} />Refresh</button>
    </div>
    {tab === "students" && <label className="mt-4 block text-sm">Risk level <select className="field ml-2" value={risk} onChange={e => { setPage(1); setRisk(e.target.value); }}><option value="">All</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    <div className="mt-5 card p-4">
      <label className="block text-sm font-semibold" htmlFor="analytics-question">Ask about current ERP performance</label>
      <div className="mt-2 flex flex-wrap gap-2"><input id="analytics-question" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void ask(); }} className="field min-w-64 flex-1" placeholder="For example: How are fees or attendance?" /><button disabled={asking || !question.trim()} onClick={() => void ask()} className="flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-white disabled:opacity-50"><BrainCircuit size={17} />{asking ? "Checking…" : "Ask" }<Send size={15} /></button></div>
      {answer && <div className="mt-3 rounded-lg bg-brand-50 p-4 text-sm dark:bg-slate-900"><b>{answer.answer}</b><p className="mt-1">{(answer.suggestedActions ?? []).join(" • ")}</p></div>}
    </div>
    {loading ? <p role="status" className="mt-5 card p-6">Loading analytics…</p> : <>
      {panels.length > 0 && <div className="mt-5 grid gap-4 md:grid-cols-2">{panels.map(panel => <section key={panel.title} className="card p-5"><h2 className="font-semibold">{panel.title}</h2><dl className="mt-3 divide-y dark:divide-slate-800">{panel.fields.map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-2 text-sm"><dt className="text-slate-500">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl></section>)}</div>}
      {tab === "admissions" && data && <div className="mt-5 grid gap-4 md:grid-cols-2">{(["bySource", "byBranch"] as const).map(key => <section key={key} className="card p-5"><h2 className="font-semibold">{key === "bySource" ? "Enquiries by source" : "Enquiries by branch"}</h2><div className="mt-3 divide-y dark:divide-slate-800">{(data[key] ?? []).map((entry: Row, index: number) => <div key={index} className="flex justify-between gap-4 py-2 text-sm"><span>{String(entry.source ?? entry.branch)}</span><span>{String(entry.converted ?? 0)} converted / {String(entry.total ?? 0)} total</span></div>)}</div></section>)}</div>}
      {(tab === "students" || tab === "teachers" || tab === "comparison") && <section className="mt-5 card overflow-x-auto p-5"><h2 className="font-semibold">{tabs.find(item => item.id === tab)?.label}</h2><p className="mt-1 text-xs text-slate-500">{meta?.total ?? rows.length} records</p><table className="mt-4 w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Name</th><th className="p-2">{tab === "students" ? "Risk" : tab === "teachers" ? "Performance" : "Students"}</th><th className="p-2">{tab === "students" ? "Attendance" : tab === "teachers" ? "Workload" : "Fees collected"}</th></tr></thead><tbody>{rows.map((row, index) => <tr className="border-b last:border-0" key={String(row.id ?? index)}><td className="p-2">{String((row.student as any)?.user?.name ?? (row.teacher as any)?.user?.name ?? row.name ?? "Unknown")}</td><td className="p-2">{tab === "students" ? String(row.riskLevel ?? "—") : tab === "teachers" ? percent(row.performanceScore) : String(row.students ?? 0)}</td><td className="p-2">{tab === "students" ? percent(row.attendanceRate) : tab === "teachers" ? percent(row.workloadScore) : rupees(row.feeCollectedPaise)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="py-5 text-sm text-slate-500">No records in this view.</p>}{meta?.total !== undefined && meta.total > page * 20 && <button className="mt-4 rounded-lg border px-3 py-2 text-sm" onClick={() => setPage(value => value + 1)}>Next page</button>}{page > 1 && <button className="ml-2 mt-4 rounded-lg border px-3 py-2 text-sm" onClick={() => setPage(value => value - 1)}>Previous page</button>}</section>}
      {tab === "executive" && data?.generatedAt && <p className="mt-3 text-xs text-slate-500">Updated {new Date(data.generatedAt).toLocaleString()} {meta?.cached ? "· cached up to 60 seconds" : ""}</p>}
    </>}
    <AnalyticsActionCenter />
    <AnalyticsSavedReports />
  </ProtectedAdminWorkspace>;
}
