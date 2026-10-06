"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Row = Record<string, any>;

async function api(path: string) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "Request failed");
  return body;
}

export default function Page() {
  const [devices, setDevices] = useState<Row[]>([]);
  const [connectors, setConnectors] = useState<Row[]>([]);
  const [adapters, setAdapters] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [d, c, a] = await Promise.all([
        api("/device-hub/devices"),
        api("/device-hub/connectors"),
        api("/device-hub/adapters"),
      ]);
      setDevices(d?.data ?? []);
      setConnectors(c?.data ?? []);
      setAdapters(a?.data ?? []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <ProtectedAdminWorkspace title="Device Hub" description="Connected Campus device, connector and adapter status.">
    <div className="mt-6 flex items-center gap-3">
      <div className="rounded-xl border bg-white px-4 py-3 text-sm dark:bg-slate-900">
        <b>{devices.length}</b> devices · <b>{connectors.length}</b> connectors · <b>{adapters.length}</b> adapters
      </div>
      <button onClick={()=>void load()} disabled={loading} className="ml-auto inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold dark:bg-slate-900">
        <RefreshCw size={16} className={loading ? "animate-spin" : ""}/>Refresh
      </button>
    </div>
    {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <section className="mt-6 grid gap-5 xl:grid-cols-2">
      <div className="card overflow-hidden">
        <div className="border-b p-4"><h2 className="font-black">Devices</h2></div>
        <div className="divide-y">{devices.map(device=><div key={device.id} className="p-4 text-sm">
          <div className="flex justify-between gap-3"><div><b>{device.name}</b><p className="text-xs text-slate-500">{device.code} · {device.kind} · {device.protocol}</p></div><span>{device.status}</span></div>
        </div>)}{!devices.length&&<p className="p-6 text-sm text-slate-500">No devices provisioned.</p>}</div>
      </div>
      <div className="card overflow-hidden">
        <div className="border-b p-4"><h2 className="font-black">Connectors</h2></div>
        <div className="divide-y">{connectors.map(connector=><div key={connector.id} className="p-4 text-sm">
          <div className="flex justify-between gap-3"><div><b>{connector.name}</b><p className="text-xs text-slate-500">{connector.adapter?.name ?? connector.adapter?.key ?? connector.adapterId}</p></div><span>{connector.status}</span></div>
        </div>)}{!connectors.length&&<p className="p-6 text-sm text-slate-500">No connector instances configured.</p>}</div>
        <div className="border-t p-4"><h3 className="text-sm font-bold">Available adapters</h3><div className="mt-2 flex flex-wrap gap-2">{adapters.map(adapter=><span key={adapter.key} className="rounded-full border px-2.5 py-1 text-xs">{adapter.name ?? adapter.key}</span>)}</div></div>
      </div>
    </section>
  </ProtectedAdminWorkspace>;
}
