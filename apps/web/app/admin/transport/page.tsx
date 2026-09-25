"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bus, Download, Fuel, MapPinned, Plus, RefreshCw, Search, Users } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";
import { OperationsQuickCreate, type QuickCreateField } from "../../../components/operations-quick-create";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Row = Record<string, any>;
type Branch = { id: string; branchName?: string; name?: string; branchCode?: string };
type VehicleType = { id: string; name: string; code?: string; seatCapacity: number };

const headers = () => ({ Authorization: `Bearer ${getAccessToken() ?? ""}` });

async function api(path: string) {
  const response = await fetch(`${API}${path}`, { headers: headers() });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "Request failed");
  return body;
}

async function downloadReport(name: string, format: "pdf" | "excel") {
  const response = await fetch(`${API}/transport/reports/${name}?format=${format}`, { headers: headers() });
  if (!response.ok) throw new Error("Export failed");
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `transport-${name}.${format === "pdf" ? "pdf" : "xls"}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Page() {
  const [tab, setTab] = useState("vehicles");
  const [rows, setRows] = useState<Row[]>([]);
  const [dashboard, setDashboard] = useState<Row>({});
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [creating, setCreating] = useState<"vehicle" | "type" | null>(null);

  const loadOptions = useCallback(async () => {
    try {
      const [branchRows, typeRows] = await Promise.all([
        api("/admin/branches?limit=100&status=active"),
        api("/transport/vehicle-types"),
      ]);
      setBranches(branchRows.data ?? []);
      setVehicleTypes(typeRows.data ?? []);
    } catch {
      setBranches([]);
      setVehicleTypes([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError("");
      setDashboard((await api("/transport/dashboard")).data);
      const path = tab === "vehicles" ? "/transport/vehicles" : tab === "drivers" ? "/transport/staff" : tab === "routes" ? "/transport/routes" : tab === "assignments" ? "/transport/assignments" : `/transport/reports/${tab}`;
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

  const vehicleFields = useMemo<QuickCreateField[]>(() => [
    { name: "branchId", label: "Branch", type: "select", required: true, options: branches.map(branch => ({ value: branch.id, label: branch.branchName ?? branch.name ?? branch.branchCode ?? branch.id })) },
    { name: "typeId", label: "Vehicle type", type: "select", required: true, options: vehicleTypes.map(type => ({ value: type.id, label: `${type.name} (max ${type.seatCapacity})` })) },
    { name: "vehicleNumber", label: "Vehicle number", required: true, placeholder: "UP14AB1234" },
    { name: "model", label: "Model", placeholder: "School Bus" },
    { name: "manufacturer", label: "Manufacturer", placeholder: "Tata" },
    { name: "manufactureYear", label: "Manufacture year", type: "number", min: 1980 },
    { name: "seatCapacity", label: "Seat capacity", type: "number", required: true, min: 1 },
    { name: "gpsDeviceId", label: "GPS device ID", placeholder: "Optional" },
  ], [branches, vehicleTypes]);

  const cards = [
    [Bus, "Vehicles", dashboard.vehicles],
    [Users, "Drivers", dashboard.drivers],
    [MapPinned, "Routes", dashboard.routes],
    [Users, "Students", dashboard.assignments],
    [Fuel, "Collections", `₹${Number(dashboard.collectedPaise ?? 0) / 100}`],
  ];

  return <ProtectedAdminWorkspace title="Transport Management" description="Fleet, staff, routes, student transport, GPS, fees and compliance.">
    <div className="mt-6 flex flex-wrap justify-end gap-2">
      {tab === "vehicles" && <>
        <button onClick={() => setCreating("type")} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold dark:bg-slate-900"><Plus size={17}/>New Vehicle Type</button>
        <button onClick={() => setCreating("vehicle")} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>Add Vehicle</button>
      </>}
      <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60 dark:bg-slate-900"><RefreshCw size={17} className={loading ? "animate-spin" : ""}/>Refresh</button>
    </div>
    {notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([Icon,label,value]) => { const I = Icon as typeof Bus; return <div className="card p-4" key={String(label)}><I className="text-brand-700"/><p className="mt-3 text-xs uppercase text-slate-400">{String(label)}</p><b>{String(value ?? 0)}</b></div>; })}</div>
    <div className="mt-6 flex gap-2 overflow-x-auto">{["vehicles","drivers","routes","assignments","occupancy","fuel","maintenance","fees"].map(name => <button key={name} onClick={() => setTab(name)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === name ? "bg-brand-700 text-white" : "border bg-white dark:bg-slate-900"}`}>{name}</button>)}</div>
    {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    <div className="my-5 flex flex-wrap gap-3">
      <div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-3" size={17}/><input value={q} onChange={event => setQ(event.target.value)} className="w-full rounded-lg border py-2.5 pl-9 dark:bg-slate-900" placeholder="Search and filter"/></div>
      <button onClick={() => void downloadReport(tab, "excel").catch(cause => setError(errorMessage(cause)))} className="flex items-center gap-2 rounded-lg border px-4"><Download size={17}/>Excel</button>
      <button onClick={() => void downloadReport(tab, "pdf").catch(cause => setError(errorMessage(cause)))} className="flex items-center gap-2 rounded-lg border px-4"><Download size={17}/>PDF</button>
    </div>
    <div className="card divide-y dark:divide-slate-800">{rows.map((row,index) => <div className="grid gap-2 p-4 text-sm sm:grid-cols-5" key={row.id ?? index}>{Object.entries(row).filter(([,value]) => typeof value !== "object").slice(0,5).map(([key,value]) => <span key={key}><small className="block uppercase text-slate-400">{key}</small>{String(value)}</span>)}</div>)}{!rows.length && <div className="p-8 text-center text-slate-500"><p>No records found.</p>{tab === "vehicles" && <button onClick={() => setCreating("vehicle")} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white"><Plus size={16}/>Add First Vehicle</button>}</div>}</div>
    {creating === "vehicle" && <OperationsQuickCreate title="Add Vehicle" description="Register a vehicle against its branch and vehicle type." endpoint="/transport/vehicles" fields={vehicleFields} defaults={{ seatCapacity: 40 }} onClose={() => setCreating(null)} onCreated={async () => { setNotice("Vehicle created successfully."); await Promise.all([load(), loadOptions()]); }}/>}
    {creating === "type" && <OperationsQuickCreate title="New Vehicle Type" endpoint="/transport/vehicle-types" fields={[{ name: "name", label: "Type name", required: true, placeholder: "School Bus" }, { name: "code", label: "Type code", required: true, placeholder: "BUS" }, { name: "seatCapacity", label: "Maximum seats", type: "number", required: true, min: 1 }]} defaults={{ seatCapacity: 40 }} onClose={() => setCreating(null)} onCreated={async () => { setNotice("Vehicle type created."); await loadOptions(); }}/>}
  </ProtectedAdminWorkspace>;
}
