"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BedDouble, Building2, Download, IndianRupee, Plus, RefreshCw, Search, Users } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";
import { OperationsQuickCreate, type QuickCreateField } from "../../../components/operations-quick-create";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Row = Record<string, unknown>;
type Branch = { id: string; branchName?: string; name?: string; branchCode?: string };

const headers = () => ({ Authorization: `Bearer ${getAccessToken() ?? ""}` });

async function api(path: string) {
  const response = await fetch(`${API}${path}`, { headers: headers() });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}

async function exportReport(name: string, format: "pdf" | "excel") {
  const response = await fetch(`${API}/hostel/reports/${name}?format=${format}`, { headers: headers() });
  if (!response.ok) throw new Error("Export failed");
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hostel-${name}.${format === "pdf" ? "pdf" : "xls"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Page() {
  const [tab, setTab] = useState("hostels");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [dashboard, setDashboard] = useState<Row>({});
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api("/admin/branches?limit=100&status=active").then(result => setBranches(result.data ?? [])).catch(() => setBranches([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError("");
      setDashboard((await api("/hostel/dashboard")).data);
      const path = tab === "hostels" ? "/hostel/hostels" : tab === "rooms" ? "/hostel/rooms" : tab === "allocations" ? "/hostel/allocations" : `/hostel/reports/${tab}`;
      const result = await api(`${path}?search=${encodeURIComponent(query)}&page=1&limit=50`);
      setRows(Array.isArray(result.data) ? result.data : []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tab, query]);

  useEffect(() => { void load(); }, [load]);

  const hostelFields = useMemo<QuickCreateField[]>(() => [
    { name: "branchId", label: "Branch", type: "select", required: true, options: branches.map(branch => ({ value: branch.id, label: branch.branchName ?? branch.name ?? branch.branchCode ?? branch.id })) },
    { name: "code", label: "Hostel code", required: true, placeholder: "HST-01" },
    { name: "name", label: "Hostel name", required: true, placeholder: "Boys Hostel" },
    { name: "gender", label: "Gender", type: "select", options: [{ value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }, { value: "OTHER", label: "Other" }] },
    { name: "capacity", label: "Total capacity", type: "number", required: true, min: 1 },
    { name: "address", label: "Address", placeholder: "Hostel address" },
  ], [branches]);

  const cards = [
    [Building2, "Hostels", dashboard.hostels],
    [BedDouble, "Rooms", dashboard.rooms],
    [Users, "Occupied", dashboard.occupied],
    [BedDouble, "Vacant", dashboard.vacant],
    [IndianRupee, "Fees due", `₹${Number(dashboard.duePaise ?? 0) / 100}`],
  ];

  return <ProtectedAdminWorkspace title="Hostel Management" description="Hostels, rooms, allocations, fees, attendance, mess, visitors, assets and maintenance.">
    <div className="mt-6 flex flex-wrap justify-end gap-2">
      {tab === "hostels" && <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>Add Hostel</button>}
      <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60 dark:bg-slate-900"><RefreshCw size={17} className={loading ? "animate-spin" : ""}/>Refresh</button>
    </div>
    {notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([Icon,label,value]) => { const I = Icon as typeof Building2; return <div className="card p-4" key={String(label)}><I className="text-brand-700"/><p className="mt-3 text-xs uppercase text-slate-400">{String(label)}</p><b>{String(value ?? 0)}</b></div>; })}</div>
    <div className="mt-6 flex gap-2 overflow-x-auto">{["hostels","rooms","allocations","occupancy","vacant","fees","students","attendance","visitors","assets"].map(name => <button key={name} onClick={() => setTab(name)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === name ? "bg-brand-700 text-white" : "border bg-white dark:bg-slate-900"}`}>{name}</button>)}</div>
    {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    <div className="my-5 flex flex-wrap gap-3">
      <div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-3" size={17}/><input value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border py-2.5 pl-9 dark:bg-slate-900" placeholder="Search hostels, rooms or students"/></div>
      <button onClick={() => void exportReport(tab, "excel").catch(cause => setError(errorMessage(cause)))} className="flex items-center gap-2 rounded-lg border px-4"><Download size={17}/>Excel</button>
      <button onClick={() => void exportReport(tab, "pdf").catch(cause => setError(errorMessage(cause)))} className="flex items-center gap-2 rounded-lg border px-4"><Download size={17}/>PDF</button>
    </div>
    <div className="card divide-y dark:divide-slate-800">{rows.map((row,index) => <div className="grid gap-2 p-4 text-sm sm:grid-cols-5" key={String(row.id ?? index)}>{Object.entries(row).filter(([,value]) => typeof value !== "object").slice(0,5).map(([key,value]) => <span key={key}><small className="block uppercase text-slate-400">{key}</small>{String(value)}</span>)}</div>)}{!rows.length && <div className="p-8 text-center text-slate-500"><p>No records found.</p>{tab === "hostels" && <button onClick={() => setCreating(true)} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white"><Plus size={16}/>Add First Hostel</button>}</div>}</div>
    {creating && <OperationsQuickCreate title="Add Hostel" description="Create the hostel master first; rooms and allocations can then be managed from this module." endpoint="/hostel/hostels" fields={hostelFields} defaults={{ capacity: 50 }} onClose={() => setCreating(false)} onCreated={async () => { setNotice("Hostel created successfully."); await load(); }}/>}
  </ProtectedAdminWorkspace>;
}
