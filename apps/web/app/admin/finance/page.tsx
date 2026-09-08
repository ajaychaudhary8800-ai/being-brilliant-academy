"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Download, Landmark, ReceiptIndianRupee, Search, Scale, Upload } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken, useAuth } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type O = Record<string, any>;

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}

const cash = (value: any) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(value ?? 0) / 100);
const show = (value: any) => value == null ? "—" : typeof value === "object" ? (value.name ?? value.branchName ?? value.code ?? JSON.stringify(value)) : String(value).replaceAll("_", " ");

function Table({ rows }: { rows: O[] }) {
  const keys = Object.keys(rows[0] ?? { status: "Status" }).filter(key => !["id", "lines", "_count"].includes(key)).slice(0, 7);
  return <div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800"><tr>{keys.map(key => <th className="p-3" key={key}>{key.replace(/([A-Z])/g, " $1")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-t dark:border-slate-800" key={row.id ?? index}>{keys.map(key => <td className="p-3" key={key}>{key.toLowerCase().includes("paise") ? cash(row[key]) : show(row[key])}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="p-6 text-slate-500">No records found.</p>}</div>;
}

function Finance() {
  const { user } = useAuth();
  const canImportAccounts = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";
  const [tab, setTab] = useState("accounts");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<O[]>([]);
  const [dashboard, setDashboard] = useState<O>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState("trial-balance");
  const [from, setFrom] = useState("2026-04-01");
  const [to, setTo] = useState("2027-03-31");

  const load = useCallback(async () => {
    try {
      setError("");
      setDashboard((await api("/finance/dashboard")).data);
      const path = tab === "accounts" ? "/finance/accounts" : tab === "vouchers" ? "/finance/entries" : tab === "expenses" ? "/finance/expenses" : tab === "vendors" ? "/finance/vendors" : tab === "banks" ? "/finance/banks" : tab === "years" ? "/finance/years" : tab === "gst" ? "/finance/gst" : "/finance/account-groups";
      const result = await api(`${path}?search=${encodeURIComponent(query)}&page=1&limit=50`);
      setRows(Array.isArray(result.data) ? result.data : result.data?.rows ?? []);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [tab, query]);

  useEffect(() => { void load(); }, [load]);

  const runReport = async () => {
    try {
      const result = await api(`/finance/reports/${report}?from=${from}&to=${to}&format=json`);
      setRows(result.data.rows ?? result.data);
      setNotice(`${report.replaceAll("-", " ")} generated`);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const download = async (path: string, name: string) => {
    try {
      const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getAccessToken()}` } });
      if (!response.ok) throw new Error("Export failed");
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(await response.blob());
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const importAccounts = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await api("/finance/import/accounts", { method: "POST", body: JSON.stringify({ rows: Array.isArray(parsed) ? parsed : parsed.rows }) });
      setNotice("Accounts imported");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const filtered = useMemo(() => rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [rows, query]);

  return <ProtectedAdminWorkspace title="Finance & Accounting ERP" description="Double-entry accounting, fee finance, expenses, banking, GST and statutory reports."><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{[[BookOpen, "Accounts", dashboard.accounts], [Scale, "Posted vouchers", dashboard.postedEntries], [Landmark, "Bank accounts", dashboard.bankAccounts], [ReceiptIndianRupee, "Fees collected", cash(dashboard.feesCollectedPaise)], [ReceiptIndianRupee, "Expenses", cash(dashboard.expensesPaise)]].map(([ItemIcon, label, value]) => { const Icon = ItemIcon as typeof BookOpen; return <article className="card p-4" key={String(label)}><Icon className="text-brand-700"/><p className="mt-3 text-xs uppercase text-slate-400">{String(label)}</p><p className="font-bold">{String(value ?? 0)}</p></article>; })}</div><div className="mt-6 flex gap-2 overflow-x-auto">{["accounts", "groups", "vouchers", "ledger", "expenses", "vendors", "banks", "years", "gst", "reports"].map(item => <button onClick={() => setTab(item)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === item ? "bg-brand-700 text-white" : "border bg-white dark:bg-slate-900"}`} key={item}>{item}</button>)}</div>{error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}{notice && <p className="mt-4 rounded-lg bg-green-50 p-3 text-green-700">{notice}</p>}<div className="my-5 flex flex-wrap gap-3"><div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-3" size={17}/><input className="w-full rounded-lg border py-2.5 pl-9 dark:bg-slate-900" placeholder="Search, filter and sort records" value={query} onChange={event => setQuery(event.target.value)}/></div><button onClick={() => void download(`/finance/export/${tab === "accounts" ? "accounts" : "entries"}?format=excel`, `${tab}.xls`)} className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 font-semibold dark:bg-slate-900"><Download size={17}/>Excel</button><button onClick={() => void download(`/finance/export/${tab === "accounts" ? "accounts" : "entries"}?format=pdf`, `${tab}.pdf`)} className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 font-semibold dark:bg-slate-900"><Download size={17}/>PDF</button>{canImportAccounts && tab === "accounts" && <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white"><Upload size={17}/>Import<input className="hidden" type="file" accept=".json" onChange={event => event.target.files?.[0] && void importAccounts(event.target.files[0])}/></label>}</div>{tab === "reports" && <section className="card mb-5 grid gap-3 p-5 md:grid-cols-5"><select className="rounded-lg border p-2 dark:bg-slate-950" value={report} onChange={event => setReport(event.target.value)}>{["trial-balance", "profit-loss", "balance-sheet", "cash-flow", "cash-book", "bank-book", "day-book", "outstanding", "income-statement"].map(item => <option key={item}>{item}</option>)}</select><input type="date" className="rounded-lg border p-2 dark:bg-slate-950" value={from} onChange={event => setFrom(event.target.value)}/><input type="date" className="rounded-lg border p-2 dark:bg-slate-950" value={to} onChange={event => setTo(event.target.value)}/><button onClick={() => void runReport()} className="rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white">Generate</button><button onClick={() => void download(`/finance/reports/${report}?from=${from}&to=${to}&format=pdf`, `${report}.pdf`)} className="rounded-lg border font-semibold">Export report</button></section>}<Table rows={filtered}/><p className="mt-4 text-xs text-slate-500">Voucher creation, posting, approval, reversal protection, account archiving, bank reconciliation, fee refunds/discounts/scholarships/fines, vendor bills, GST and audit operations are exposed through secured finance APIs.</p></ProtectedAdminWorkspace>;
}

export default Finance;
