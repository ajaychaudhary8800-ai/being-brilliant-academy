"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, CircleDot, RefreshCw,
  ServerCog, ShieldCheck, Target, XCircle,
} from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken, useAuth } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const API_ROOT = API.replace(/\/v1\/?$/, "");

type RoadmapStep = {
  step: number;
  name: string;
  status: "COMPLETE" | "PENDING_EXTERNAL" | "PENDING_CLIENT" | "BLOCKED_DEPENDENCY";
  summary: string;
  webRoutes: string[];
  dependency?: string;
  externalControl?: string;
};
type Roadmap = { asOf: string; product: string; steps: RoadmapStep[] };
type LaunchGate = {
  id: string;
  name: string;
  blocking: boolean;
  status: string;
  dependency?: string;
  nextAction?: string;
  note?: string;
};
type Launch = { declaredStatus: "GO" | "HOLD"; gates: LaunchGate[] };
type ControlCenter = { roadmap: Roadmap; launch: Launch; generatedAt: string };
type ReadyHealth = { status: string; checks?: Record<string, boolean> };
type OperationalHealth = {
  status: string;
  checks?: Record<string, boolean>;
  workers?: Record<string, { healthy: boolean; lastSuccessAt: string | null; lastFailureAt: string | null }>;
};
type IntegrationHealth = {
  smtp?: { configured?: boolean; reachable?: boolean; error?: string | null };
  razorpayMode?: string;
};

const authHeaders = () => ({ Authorization: `Bearer ${getAccessToken() ?? ""}` });

async function getJson(url: string, authenticated = false, acceptedStatuses: number[] = []) {
  const response = await fetch(url, { cache: "no-store", headers: authenticated ? authHeaders() : undefined });
  const json = await response.json().catch(() => null);
  if (json === null) throw new Error(`Invalid response from ${url}`);
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw new Error(json?.error?.message ?? `Request failed (${response.status})`);
  }
  return json;
}

const statusClass: Record<RoadmapStep["status"], string> = {
  COMPLETE: "bg-emerald-100 text-emerald-800",
  PENDING_EXTERNAL: "bg-amber-100 text-amber-800",
  PENDING_CLIENT: "bg-blue-100 text-blue-800",
  BLOCKED_DEPENDENCY: "bg-rose-100 text-rose-800",
};

const statusLabel: Record<RoadmapStep["status"], string> = {
  COMPLETE: "Complete",
  PENDING_EXTERNAL: "External action",
  PENDING_CLIENT: "Real client required",
  BLOCKED_DEPENDENCY: "Blocked",
};

export default function Page() {
  const { user } = useAuth();
  const platform = user?.role === "SUPER_ADMIN" && user.organizationId === "org_default";
  const [control, setControl] = useState<ControlCenter | null>(null);
  const [ready, setReady] = useState<ReadyHealth | null>(null);
  const [operational, setOperational] = useState<OperationalHealth | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationHealth | null>(null);
  const [error, setError] = useState("");
  const [healthError, setHealthError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!platform) return;
    setBusy(true);
    setError("");
    setHealthError("");
    try {
      const json = await getJson(`${API}/platform/control-center`, true);
      setControl(json.data);
    } catch (cause) {
      setControl(null);
      setError(errorMessage(cause));
    }
    const health = await Promise.allSettled([
      getJson(`${API_ROOT}/health/ready`, false, [503]),
      getJson(`${API_ROOT}/health/operational`, false, [503]),
      getJson(`${API_ROOT}/health/integrations`, false, [503]),
    ]);
    if (health[0].status === "fulfilled") setReady(health[0].value as ReadyHealth);
    if (health[1].status === "fulfilled") setOperational(health[1].value as OperationalHealth);
    if (health[2].status === "fulfilled") setIntegrations(health[2].value as IntegrationHealth);
    if (health.some(item => item.status === "rejected")) {
      setHealthError("One or more live health endpoints could not be read. Check the latest deployment and reverse-proxy/API routing.");
    }
    setBusy(false);
  }, [platform]);

  useEffect(() => {
    void load();
  }, [load]);

  const completeCount = useMemo(
    () => control ? control.roadmap.steps.filter(step => step.status === "COMPLETE").length : null,
    [control],
  );
  const blockers = useMemo(
    () => control ? control.launch.gates.filter(gate => gate.blocking && gate.status !== "READY") : null,
    [control],
  );

  const launchStatus = control?.launch.declaredStatus;
  const readyTone = ready ? (ready.status === "ready" ? "good" : "warn") : "neutral";
  const operationalTone = operational ? (operational.status === "operational" ? "good" : "warn") : "neutral";
  const launchTone = launchStatus ? (launchStatus === "GO" ? "good" : "warn") : "neutral";

  return <ProtectedAdminWorkspace
    roles={["SUPER_ADMIN"]}
    title="SaaS Control Center"
    description="One place to track the complete 14-step SaaS program, open every web-controlled workspace, and inspect live operational and launch readiness."
  >
    {!platform ? <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">This workspace is available only to the Platform Super Admin.</div> :
    <div className="mt-6 space-y-6">
      <section className="card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-brand-700"><ShieldCheck size={18}/><span className="text-xs font-bold uppercase tracking-wider">Platform command view</span></div>
            <h2 className="mt-2 text-xl font-bold">{control?.roadmap.product ?? "Being Brilliant ERP + LMS + CRM"}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">This page is a control surface, not a replacement for protected GitHub, Coolify/VPS or external backup credentials. Sensitive infrastructure actions remain outside the ERP by design.</p>
          </div>
          <button type="button" disabled={busy} onClick={() => void load()} className="inline-flex items-center gap-2 self-start rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw size={16}/>{busy ? "Refreshing…" : "Refresh live status"}</button>
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {healthError && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{healthError}</p>}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Target size={18}/>} label="Roadmap complete" value={completeCount === null ? "—/14" : `${completeCount}/14`} tone="neutral"/>
        <MetricCard icon={launchStatus === "GO" ? <CheckCircle2 size={18}/> : launchStatus === "HOLD" ? <AlertTriangle size={18}/> : <CircleDot size={18}/>} label="Commercial launch" value={launchStatus ?? "Unknown"} tone={launchTone}/>
        <MetricCard icon={ready?.status === "ready" ? <CheckCircle2 size={18}/> : ready ? <XCircle size={18}/> : <CircleDot size={18}/>} label="API readiness" value={ready?.status ?? "Unknown"} tone={readyTone}/>
        <MetricCard icon={operational?.status === "operational" ? <Activity size={18}/> : operational ? <AlertTriangle size={18}/> : <CircleDot size={18}/>} label="Operational health" value={operational?.status ?? "Unknown"} tone={operationalTone}/>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.8fr)]">
        <div className="card overflow-hidden">
          <div className="border-b p-5">
            <h2 className="text-lg font-bold">1–14 roadmap</h2>
            <p className="mt-1 text-sm text-slate-500">Every step shows what was done and where you control or inspect it from the website.</p>
          </div>
          {!control ? <div className="p-5 text-sm text-slate-500">Roadmap data is temporarily unavailable. Refresh after the API deployment is healthy.</div> :
          <div className="divide-y">
            {control.roadmap.steps.map(step => <div key={step.step} className="p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{step.step}</span>
                    <h3 className="font-bold">{step.name}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass[step.status]}`}>{statusLabel[step.status]}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{step.summary}</p>
                  {step.dependency && <p className="mt-2 text-xs font-semibold text-amber-700">Dependency: {step.dependency}</p>}
                  {step.externalControl && <p className="mt-2 text-xs leading-5 text-slate-500"><b>External control:</b> {step.externalControl}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-[290px] lg:justify-end">
                  {step.webRoutes.map(route => <Link key={route} href={route} className="rounded-lg border px-3 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50">{route === "/admin/control-center" ? "View here" : route.replace("/admin/","").replaceAll("-"," ")}</Link>)}
                </div>
              </div>
            </div>)}
          </div>}
        </div>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold"><ServerCog size={19}/>Live platform health</h2>
            <div className="mt-4 space-y-3 text-sm">
              <HealthRow label="Database" ok={ready?.checks?.database}/>
              <HealthRow label="Redis" ok={ready?.checks?.redis}/>
              {Object.entries(operational?.workers ?? {}).map(([name, worker]) => <HealthRow key={name} label={name.replace(/([A-Z])/g," $1")} ok={worker.healthy} detail={worker.lastSuccessAt ? `Last success ${new Date(worker.lastSuccessAt).toLocaleString()}` : "No successful heartbeat reported"}/>)}
              <HealthRow label="SMTP" ok={integrations?.smtp?.configured ? integrations.smtp.reachable === true : undefined} detail={integrations?.smtp?.configured ? integrations?.smtp?.reachable ? "Configured and reachable" : integrations?.smtp?.error || "Configured but unreachable" : "Not configured"}/>
              {integrations?.razorpayMode && <div className="rounded-xl border p-3"><span className="font-semibold">Razorpay mode</span><span className="float-right font-bold">{integrations.razorpayMode}</span></div>}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-lg font-bold">Launch blockers</h2>
            <p className="mt-1 text-sm text-slate-500">{!control ? "Launch readiness data is temporarily unavailable." : launchStatus === "GO" ? "All blocking launch gates are ready." : "These conditions still hold the commercial launch."}</p>
            <div className="mt-4 space-y-3">
              {!control && <div className="rounded-xl border bg-slate-50 p-3 text-sm font-semibold text-slate-600">Launch status unavailable — refresh after API recovery.</div>}
              {blockers?.map(gate => <div key={gate.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="flex items-start gap-2"><CircleDot className="mt-0.5 shrink-0" size={15}/><div><b>{gate.name}</b><div className="mt-1 text-xs">{gate.status}{gate.dependency ? ` · ${gate.dependency}` : ""}</div>{gate.nextAction && <p className="mt-2 text-xs leading-5">{gate.nextAction}</p>}</div></div>
              </div>)}
              {control && blockers?.length === 0 && <div className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">GO — all blocking gates are ready.</div>}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-lg font-bold">Main web controls</h2>
            <div className="mt-4 grid gap-2 text-sm">
              {[
                ["/admin/organizations","Organizations & onboarding"],
                ["/admin/saas-plans","SaaS plans & pricing"],
                ["/admin/saas-billing","Billing & subscriptions"],
                ["/admin/saas-sales","SaaS sales pipeline"],
                ["/admin/legal-sales","Sales/legal documents"],
                ["/admin/implementation-kit","Implementation & UAT"],
              ].map(([href,label]) => <Link key={href} href={href} className="rounded-xl border p-3 font-semibold hover:border-brand-300 hover:text-brand-700">{label}</Link>)}
            </div>
          </section>
        </div>
      </section>
    </div>}
  </ProtectedAdminWorkspace>;
}

function MetricCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "neutral" | "good" | "warn" }) {
  const cls = tone === "good" ? "bg-emerald-50 text-emerald-800" : tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100";
  return <div className={`rounded-2xl border p-4 ${cls}`}><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-80">{icon}{label}</div><div className="mt-3 text-2xl font-black capitalize">{value}</div></div>;
}

function HealthRow({ label, ok, detail }: { label: string; ok?: boolean; detail?: string }) {
  return <div className="rounded-xl border p-3"><div className="flex items-center justify-between gap-3"><span className="font-semibold capitalize">{label}</span><span className={`inline-flex items-center gap-1 text-xs font-bold ${ok === true ? "text-emerald-700" : ok === false ? "text-rose-700" : "text-slate-500"}`}>{ok === true ? <CheckCircle2 size={14}/> : ok === false ? <XCircle size={14}/> : <CircleDot size={14}/>}{ok === true ? "Healthy" : ok === false ? "Needs attention" : "Unknown"}</span></div>{detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}</div>;
}
