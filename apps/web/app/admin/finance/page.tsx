"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Download, Landmark, Plus, ReceiptIndianRupee, RefreshCw, Search, Scale, Upload } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken, useAuth } from "../../../components/auth-provider";
import { OperationsQuickCreate, type QuickCreateField } from "../../../components/operations-quick-create";
import { csvTemplate, parseTabularFile } from "../../../components/tabular-import";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type O = Record<string, any>;
type Branch = { id: string; branchName?: string; name?: string; branchCode?: string };
type Group = { id: string; name: string; code: string; type: string; isArchived?: boolean };

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAccessToken() ?? ""}`,
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

function Table({ rows, emptyAction }: { rows: O[]; emptyAction?: React.ReactNode }) {
  const keys = Object.keys(rows[0] ?? { status: "Status" }).filter(key => !["id", "lines", "_count"].includes(key)).slice(0, 7);
  return <div className="card overflow-x-auto">
    <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800"><tr>{keys.map(key => <th className="p-3" key={key}>{key.replace(/([A-Z])/g, " $1")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className="border-t dark:border-slate-800" key={row.id ?? index}>{keys.map(key => <td className="p-3" key={key}>{key.toLowerCase().includes("paise") ? cash(row[key]) : show(row[key])}</td>)}</tr>)}</tbody></table>
    {!rows.length && <div className="p-8 text-center text-slate-500"><p>No records found.</p>{emptyAction}</div>}
  </div>;
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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const [branchRows, groupRows] = await Promise.all([
        api("/admin/branches?limit=100&status=active"),
        api("/finance/account-groups"),
      ]);
      setBranches(branchRows.data ?? []);
      setGroups((groupRows.data ?? []).filter((group: Group) => !group.isArchived));
    } catch {
      setBranches([]);
      setGroups([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError("");
      setDashboard((await api("/finance/dashboard")).data);
      const path = tab === "accounts" ? "/finance/accounts" : tab === "vouchers" ? "/finance/entries" : tab === "expenses" ? "/finance/expenses" : tab === "vendors" ? "/finance/vendors" : tab === "banks" ? "/finance/banks" : tab === "years" ? "/finance/years" : tab === "gst" ? "/finance/gst" : "/finance/account-groups";
      const result = await api(`${path}?search=${encodeURIComponent(query)}&page=1&limit=50`);
      setRows(Array.isArray(result.data) ? result.data : result.data?.rows ?? []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tab, query]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
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
      const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } });
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
      setError(""); setNotice("");
      const importedRows = await parseTabularFile(file);
      const result = await api("/finance/import/accounts", { method: "POST", body: JSON.stringify({ rows: importedRows }) });
      setNotice(`${result.data?.length ?? importedRows.length} accounts imported successfully`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const downloadAccountTemplate = () => {
    const content = csvTemplate(["branchId", "groupId", "code", "name", "type", "openingDebitPaise", "openingCreditPaise", "gstin", "pan", "isSystem"]);
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    anchor.download = "finance-account-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const accountFields = useMemo<QuickCreateField[]>(() => [
    { name: "branchId", label: "Branch", type: "select", required: true, options: branches.map(branch => ({ value: branch.id, label: branch.branchName ?? branch.name ?? branch.branchCode ?? branch.id })) },
    { name: "groupId", label: "Account group", type: "select", required: true, options: groups.map(group => ({ value: group.id, label: `${group.code} · ${group.name} (${group.type})` })) },
    { name: "code", label: "Account code", required: true, placeholder: "1001" },
    { name: "name", label: "Account name", required: true, placeholder: "Cash in Hand" },
    { name: "type", label: "Account type", type: "select", required: true, help: "Must match the selected account group's type.", options: ["ASSET","LIABILITY","EQUITY","INCOME","EXPENSE"].map(value => ({ value, label: value })) },
    { name: "openingDebitPaise", label: "Opening debit (paise)", type: "number", min: 0 },
    { name: "openingCreditPaise", label: "Opening credit (paise)", type: "number", min: 0 },
    { name: "gstin", label: "GSTIN", placeholder: "Optional" },
  ], [branches, groups]);

  const filtered = useMemo(() => rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [rows, query]);

  return <ProtectedAdminWorkspace title="Finance & Accounting ERP" description="Double-entry accounting, fee finance, expenses, banking, GST and statutory reports.">
    <div className="mt-6 flex flex-wrap justify-end gap-2">
      {canImportAccounts && tab === "accounts" && <button onClick={() => setCreatingAccount(true)} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>Add Account</button>}
      <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60 dark:bg-slate-900"><RefreshCw size={17} className={loading ? "animate-spin" : ""}/>Refresh</button>
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{[[BookOpen, "Accounts", dashboard.accounts], [Scale, "Posted vouchers", dashboard.postedEntries], [Landmark, "Bank accounts", dashboard.bankAccounts], [ReceiptIndianRupee, "Fees collected", cash(dashboard.feesCollectedPaise)], [ReceiptIndianRupee, "Expenses", cash(dashboard.expensesPaise)]].map(([ItemIcon, label, value]) => { const Icon = ItemIcon as typeof BookOpen; return <article className="card p-4" key={String(label)}><Icon className="text-brand-700"/><p className="mt-3 text-xs uppercase text-slate-400">{String(label)}</p><p className="font-bold">{String(value ?? 0)}</p></article>; })}</div>
    <div className="mt-6 flex gap-2 overflow-x-auto">{["accounts", "groups", "vouchers", "ledger", "expenses", "vendors", "banks", "years", "gst", "reports"].map(item => <button onClick={() => setTab(item)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === item ? "bg-brand-700 text-white" : "border bg-white dark:bg-slate-900"}`} key={item}>{item}</button>)}</div>
    {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    {notice && <p className="mt-4 rounded-lg bg-green-50 p-3 text-green-700">{notice}</p>}
    <div className="my-5 flex flex-wrap gap-3">
      <div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-3" size={17}/><input className="w-full rounded-lg border py-2.5 pl-9 dark:bg-slate-900" placeholder="Search, filter and sort records" value={query} onChange={event => setQuery(event.target.value)}/></div>
      <button onClick={() => void download(`/finance/export/${tab === "accounts" ? "accounts" : "entries"}?format=excel`, `${tab}.xls`)} className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 font-semibold dark:bg-slate-900"><Download size={17}/>Excel</button>
      <button onClick={() => void download(`/finance/export/${tab === "accounts" ? "accounts" : "entries"}?format=pdf`, `${tab}.pdf`)} className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 font-semibold dark:bg-slate-900"><Download size={17}/>PDF</button>
      {canImportAccounts && tab === "accounts" && <>
        <button type="button" onClick={downloadAccountTemplate} className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 font-semibold dark:bg-slate-900"><Download size={17}/>Import template</button>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-white px-4 py-2 font-semibold dark:bg-slate-900"><Upload size={17}/>Import accounts<input className="hidden" type="file" accept=".xlsx,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importAccounts(file); }}/></label>
      </>}
    </div>
    {tab === "reports" && <section className="card mb-5 grid gap-3 p-5 md:grid-cols-5">
      <select className="rounded-lg border p-2 dark:bg-slate-950" value={report} onChange={event => setReport(event.target.value)}>{["trial-balance", "profit-loss", "balance-sheet", "cash-flow", "cash-book", "bank-book", "day-book", "outstanding", "income-statement"].map(item => <option key={item}>{item}</option>)}</select>
      <input type="date" className="rounded-lg border p-2 dark:bg-slate-950" value={from} onChange={event => setFrom(event.target.value)}/>
      <input type="date" className="rounded-lg border p-2 dark:bg-slate-950" value={to} onChange={event => setTo(event.target.value)}/>
      <button onClick={() => void runReport()} className="rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white">Generate</button>
      <button onClick={() => void download(`/finance/reports/${report}?from=${from}&to=${to}&format=pdf`, `${report}.pdf`)} className="rounded-lg border font-semibold">Export report</button>
    </section>}
    <Table rows={filtered} emptyAction={tab === "accounts" && canImportAccounts ? <button onClick={() => setCreatingAccount(true)} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white"><Plus size={16}/>Add First Account</button> : undefined}/>
    {creatingAccount && <OperationsQuickCreate title="Add Ledger Account" description="Create an account in an active branch and account group." endpoint="/finance/accounts" fields={accountFields} defaults={{ openingDebitPaise: 0, openingCreditPaise: 0 }} onClose={() => setCreatingAccount(false)} onCreated={async () => { setNotice("Account created successfully."); await Promise.all([load(), loadOptions()]); }}/>}
  </ProtectedAdminWorkspace>;
}

export default Finance;
