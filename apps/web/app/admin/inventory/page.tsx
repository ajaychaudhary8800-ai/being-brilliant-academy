"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, Download, PackageCheck, Plus, RefreshCw, Search, Store, TicketCheck } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";
import { OperationsQuickCreate, type QuickCreateField } from "../../../components/operations-quick-create";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Row = Record<string, unknown>;
type OptionRow = { id: string; name?: string; branchName?: string; code?: string };

const headers = () => ({ Authorization: `Bearer ${getAccessToken() ?? ""}` });

async function api(path: string) {
  const response = await fetch(`${API}${path}`, { headers: headers() });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}

async function download(report: string, format: "pdf" | "excel") {
  const response = await fetch(`${API}/inventory/reports/${report}?format=${format}`, { headers: headers() });
  if (!response.ok) throw new Error("Export failed");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `inventory-${report}.${format === "pdf" ? "pdf" : "xls"}`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Page() {
  const [tab, setTab] = useState("assets");
  const [rows, setRows] = useState<Row[]>([]);
  const [dashboard, setDashboard] = useState<Row>({});
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState<"asset" | "item" | null>(null);
  const [branches, setBranches] = useState<OptionRow[]>([]);
  const [assetCategories, setAssetCategories] = useState<OptionRow[]>([]);
  const [itemCategories, setItemCategories] = useState<OptionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const [branchRows, assetCategoryRows, itemCategoryRows] = await Promise.all([
        api("/admin/branches?limit=100&status=active"),
        api("/inventory/asset-categories"),
        api("/inventory/item-categories"),
      ]);
      setBranches(branchRows.data ?? []);
      setAssetCategories(assetCategoryRows.data ?? []);
      setItemCategories(itemCategoryRows.data ?? []);
    } catch {
      // Main module loading reports actionable errors; option loading should not blank the page.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError("");
      setDashboard((await api("/inventory/dashboard")).data);
      const path = tab === "assets" ? "/inventory/assets" : tab === "items" ? "/inventory/items" : tab === "maintenance" ? "/inventory/maintenance" : tab === "alerts" ? "/inventory/alerts" : `/inventory/reports/${tab}`;
      const result = await api(`${path}?search=${encodeURIComponent(search)}&page=1&limit=50`);
      setRows(Array.isArray(result.data) ? result.data : [...(result.data?.lowStock ?? []), ...(result.data?.expiring ?? [])]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => { void load(); }, [load]);

  const assetFields = useMemo<QuickCreateField[]>(() => [
    { name: "branchId", label: "Branch", type: "select", required: true, options: branches.map(row => ({ value: row.id, label: row.branchName ?? row.name ?? row.code ?? row.id })) },
    { name: "categoryId", label: "Asset category", type: "select", required: true, options: assetCategories.map(row => ({ value: row.id, label: row.name ?? row.code ?? row.id })) },
    { name: "assetCode", label: "Asset code", required: true, placeholder: "AST-001" },
    { name: "name", label: "Asset name", required: true, placeholder: "Smart Board" },
    { name: "purchaseCostPaise", label: "Purchase cost (paise)", type: "number", required: true, min: 0, help: "₹1,000 = 100000 paise" },
    { name: "usefulLifeMonths", label: "Useful life (months)", type: "number", required: true, min: 1 },
    { name: "residualValuePaise", label: "Residual value (paise)", type: "number", min: 0 },
    { name: "condition", label: "Condition", required: true, placeholder: "GOOD" },
  ], [branches, assetCategories]);

  const itemFields = useMemo<QuickCreateField[]>(() => [
    { name: "categoryId", label: "Item category", type: "select", required: true, options: itemCategories.map(row => ({ value: row.id, label: row.name ?? row.code ?? row.id })) },
    { name: "sku", label: "SKU", required: true, placeholder: "STN-001" },
    { name: "name", label: "Item name", required: true, placeholder: "A4 Paper" },
    { name: "unit", label: "Unit", required: true, placeholder: "ream" },
    { name: "minimumStock", label: "Minimum stock", type: "number", required: true, min: 0 },
    { name: "reorderLevel", label: "Reorder level", type: "number", required: true, min: 0 },
    { name: "reorderQuantity", label: "Reorder quantity", type: "number", required: true, min: 0 },
  ], [itemCategories]);

  const cards = [
    [Boxes, "Assets", dashboard.assets],
    [PackageCheck, "Inventory items", dashboard.items],
    [Store, "Stores", dashboard.stores],
    [TicketCheck, "Open maintenance", dashboard.openTickets],
    [AlertTriangle, "Low stock", dashboard.lowStock],
  ];

  const primaryAction = tab === "assets" ? { label: "Add Asset", run: () => setCreating("asset") } : tab === "items" ? { label: "Add Item", run: () => setCreating("item") } : null;

  return <ProtectedAdminWorkspace title="Inventory & Asset Management" description="Enterprise asset register, procurement, stock ledger, consumables, maintenance and ERP integrations.">
    <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
      {primaryAction && <button onClick={primaryAction.run} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>{primaryAction.label}</button>}
      <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60 dark:bg-slate-900"><RefreshCw size={17} className={loading ? "animate-spin" : ""}/>Refresh</button>
    </div>
    {notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([Icon, label, value]) => { const I = Icon as typeof Boxes; return <div className="card p-4" key={String(label)}><I className="text-brand-700"/><p className="mt-3 text-xs uppercase text-slate-400">{String(label)}</p><b>{String(value ?? 0)}</b></div>; })}</div>
    <div className="mt-6 flex gap-2 overflow-x-auto">{["assets","items","maintenance","alerts","valuation","depreciation","vendors","purchases","movements"].map(name => <button key={name} onClick={() => setTab(name)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === name ? "bg-brand-700 text-white" : "border bg-white dark:bg-slate-900"}`}>{name}</button>)}</div>
    {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    <div className="my-5 flex flex-wrap gap-3">
      <div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-3" size={17}/><input value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border py-2.5 pl-9 dark:bg-slate-900" placeholder="Search assets, tags, barcode, SKU or tickets"/></div>
      <button onClick={() => void download(tab, "excel").catch(cause => setError(errorMessage(cause)))} className="flex items-center gap-2 rounded-lg border px-4"><Download size={17}/>Excel</button>
      <button onClick={() => void download(tab, "pdf").catch(cause => setError(errorMessage(cause)))} className="flex items-center gap-2 rounded-lg border px-4"><Download size={17}/>PDF</button>
    </div>
    <div className="card divide-y dark:divide-slate-800">{rows.map((row, index) => <div className="grid gap-2 p-4 text-sm sm:grid-cols-5" key={String(row.id ?? index)}>{Object.entries(row).filter(([, value]) => typeof value !== "object").slice(0,5).map(([key,value]) => <span key={key}><small className="block uppercase text-slate-400">{key}</small>{String(value)}</span>)}</div>)}{!rows.length && <div className="p-8 text-center text-slate-500"><p>No records found.</p>{primaryAction && <button onClick={primaryAction.run} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white"><Plus size={16}/>{primaryAction.label}</button>}</div>}</div>
    {creating === "asset" && <OperationsQuickCreate title="Add Asset" description="Register an asset against its branch and category." endpoint="/inventory/assets" fields={assetFields} defaults={{ purchaseCostPaise: 0, residualValuePaise: 0, usefulLifeMonths: 60, condition: "GOOD" }} onClose={() => setCreating(null)} onCreated={async () => { setNotice("Asset created successfully."); await load(); }}/>}
    {creating === "item" && <OperationsQuickCreate title="Add Inventory Item" description="Create an inventory SKU and reorder thresholds." endpoint="/inventory/items" fields={itemFields} defaults={{ minimumStock: 0, reorderLevel: 0, reorderQuantity: 0 }} onClose={() => setCreating(null)} onCreated={async () => { setNotice("Inventory item created successfully."); await load(); }}/>}
  </ProtectedAdminWorkspace>;
}
