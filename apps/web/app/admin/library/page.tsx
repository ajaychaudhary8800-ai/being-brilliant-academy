"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Download, Library, Plus, RefreshCw, Search, Users } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";
import { OperationsQuickCreate, type QuickCreateField } from "../../../components/operations-quick-create";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Row = Record<string, any>;
type Branch = { id: string; branchName?: string; name?: string; branchCode?: string };
type Category = { id: string; name: string; code?: string };

const headers = () => ({ Authorization: `Bearer ${getAccessToken() ?? ""}` });

async function api(path: string) {
  const response = await fetch(`${API}${path}`, { headers: headers() });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "Request failed");
  return body;
}

async function downloadReport(name: string, format: "pdf" | "excel") {
  const response = await fetch(`${API}/library/reports/${name}?format=${format}`, { headers: headers() });
  if (!response.ok) throw new Error("Export failed");
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `library-${name}.${format === "pdf" ? "pdf" : "xls"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Page() {
  const [tab, setTab] = useState("books");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [dashboard, setDashboard] = useState<Row>({});
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [creating, setCreating] = useState<"book" | "category" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const [branchRows, categoryRows] = await Promise.all([
        api("/admin/branches?limit=100&status=active"),
        api("/library/categories"),
      ]);
      setBranches(branchRows.data ?? []);
      setCategories(categoryRows.data ?? []);
    } catch {
      setBranches([]);
      setCategories([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError("");
      setDashboard((await api("/library/dashboard")).data);
      const path = tab === "books" ? "/library/books" : tab === "members" ? "/library/members" : `/library/reports/${tab}`;
      const result = await api(`${path}?search=${encodeURIComponent(q)}&page=1&limit=50`);
      setRows(Array.isArray(result.data) ? result.data : []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tab, q]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => { void load(); }, [load]);

  const bookFields = useMemo<QuickCreateField[]>(() => [
    { name: "branchId", label: "Branch", type: "select", required: true, options: branches.map(branch => ({ value: branch.id, label: branch.branchName ?? branch.name ?? branch.branchCode ?? branch.id })) },
    { name: "categoryId", label: "Category", type: "select", required: true, options: categories.map(category => ({ value: category.id, label: category.name })) },
    { name: "title", label: "Book title", required: true, placeholder: "Concepts of Physics" },
    { name: "isbn", label: "ISBN", placeholder: "Optional ISBN" },
    { name: "language", label: "Language", required: true, placeholder: "English" },
    { name: "edition", label: "Edition", placeholder: "1st" },
    { name: "publicationYear", label: "Publication year", type: "number", min: 1000 },
  ], [branches, categories]);

  const cards = [
    [Library, "Titles", dashboard.books],
    [BookOpen, "Copies", dashboard.copies],
    [BookOpen, "Available", dashboard.available],
    [Users, "Issued", dashboard.issued],
    [Users, "Members", dashboard.members],
  ];

  return <ProtectedAdminWorkspace title="Library Management" description="Catalog, copy inventory, circulation, members, digital resources and acquisitions.">
    <div className="mt-6 flex flex-wrap justify-end gap-2">
      {tab === "books" && <>
        <button onClick={() => setCreating("category")} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold dark:bg-slate-900"><Plus size={17}/>New Category</button>
        <button onClick={() => setCreating("book")} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>Add Book</button>
      </>}
      <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60 dark:bg-slate-900"><RefreshCw size={17} className={loading ? "animate-spin" : ""}/>Refresh</button>
    </div>
    {notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([Icon,label,value]) => { const I = Icon as typeof Library; return <div className="card p-4" key={String(label)}><I className="text-brand-700"/><p className="mt-3 text-xs uppercase text-slate-400">{String(label)}</p><b>{String(value ?? 0)}</b></div>; })}</div>
    <div className="mt-6 flex gap-2 overflow-x-auto">{["books","members","issues","returns","fines","popular","inventory"].map(name => <button key={name} onClick={() => setTab(name)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === name ? "bg-brand-700 text-white" : "border bg-white dark:bg-slate-900"}`}>{name}</button>)}</div>
    {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    <div className="my-5 flex flex-wrap gap-3">
      <div className="relative min-w-64 flex-1"><Search size={17} className="absolute left-3 top-3"/><input className="w-full rounded-lg border py-2.5 pl-9 dark:bg-slate-900" placeholder="Search ISBN, title, accession or member" value={q} onChange={event => setQ(event.target.value)}/></div>
      <button onClick={() => void downloadReport(tab, "excel").catch(cause => setError(errorMessage(cause)))} className="flex items-center gap-2 rounded-lg border px-4"><Download size={17}/>Excel</button>
      <button onClick={() => void downloadReport(tab, "pdf").catch(cause => setError(errorMessage(cause)))} className="flex items-center gap-2 rounded-lg border px-4"><Download size={17}/>PDF</button>
    </div>
    <div className="card divide-y dark:divide-slate-800">{rows.map((row,index) => <div className="grid gap-2 p-4 text-sm sm:grid-cols-5" key={row.id ?? index}>{Object.entries(row).filter(([,value]) => typeof value !== "object").slice(0,5).map(([key,value]) => <span key={key}><small className="block uppercase text-slate-400">{key}</small>{String(value)}</span>)}</div>)}{!rows.length && <div className="p-8 text-center text-slate-500"><p>No records found.</p>{tab === "books" && <button onClick={() => setCreating("book")} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white"><Plus size={16}/>Add First Book</button>}</div>}</div>
    {creating === "book" && <OperationsQuickCreate title="Add Book" description="Create a catalog title. Copies can be added after the title exists." endpoint="/library/books" fields={bookFields} defaults={{ language: "English" }} onClose={() => setCreating(null)} onCreated={async () => { setNotice("Book added successfully."); await Promise.all([load(), loadOptions()]); }}/>}
    {creating === "category" && <OperationsQuickCreate title="New Library Category" endpoint="/library/categories" fields={[{ name: "name", label: "Category name", required: true }, { name: "code", label: "Category code", required: true }]} onClose={() => setCreating(null)} onCreated={async () => { setNotice("Library category created."); await loadOptions(); }}/>}
  </ProtectedAdminWorkspace>;
}
