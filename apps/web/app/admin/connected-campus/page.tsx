"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, FileLock2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken, useAuth } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Row = Record<string, any>;

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken() ?? ""}`,
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "Request failed");
  return body;
}

const purposes = ["ACADEMIC","ATTENDANCE","TRANSPORT","SAFETY","VIDEO_SECURITY","ASSESSMENT_AI","COMMUNICATION","ANALYTICS","DEVICE_INTEGRATION"];
const retentionActions = ["DELETE","ANONYMIZE","ARCHIVE","REVIEW"];
const certificationKinds = ["HARDWARE_ADAPTER","HARDWARE_DEVICE","AI_GRADING","SECURITY_PRIVACY"];
const certificationEnvironments = ["STAGING","PRODUCTION_LIKE","REAL_DEVICE","BENCHMARK"];

export default function Page() {
  const { user } = useAuth();
  const [tab, setTab] = useState("readiness");
  const [readiness, setReadiness] = useState<Row | null>(null);
  const [policies, setPolicies] = useState<Row[]>([]);
  const [requests, setRequests] = useState<Row[]>([]);
  const [certifications, setCertifications] = useState<Row[]>([]);
  const [branches, setBranches] = useState<Row[]>([]);
  const [devices, setDevices] = useState<Row[]>([]);
  const [adapters, setAdapters] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [policyForm, setPolicyForm] = useState<Row>({ branchId:"", purpose:"SAFETY", subjectType:"", retentionDays:365, action:"REVIEW", legalBasis:"Institution-approved operational and safety purpose", policyVersion:"1.0" });
  const [certForm, setCertForm] = useState<Row>({ capabilityKey:"", kind:"HARDWARE_DEVICE", environment:"REAL_DEVICE", adapterKey:"", deviceId:"", benchmarkRunId:"", vendor:"", hardwareModel:"", firmwareVersion:"", protocolVersion:"", testedAt:"", expiresAt:"", evidence:"{}" });

  const superAdmin = user?.role === "SUPER_ADMIN";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const tasks: Promise<any>[] = [
        api("/connected-campus/governance/retention-policies?activeOnly=false"),
        api("/connected-campus/governance/data-requests?limit=200"),
        api("/connected-campus/governance/certifications?limit=200"),
        api("/admin/branches?limit=100&status=active"),
        api("/device-hub/devices"),
        api("/device-hub/adapters"),
      ];
      if (superAdmin) tasks.push(api("/connected-campus/governance/readiness"));
      const result = await Promise.all(tasks);
      setPolicies(result[0]?.data ?? []);
      setRequests(result[1]?.data ?? []);
      setCertifications(result[2]?.data ?? []);
      setBranches(result[3]?.data ?? []);
      setDevices(result[4]?.data ?? []);
      setAdapters(result[5]?.data ?? []);
      if (superAdmin) setReadiness(result[6]?.data ?? null);
      else setReadiness(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [superAdmin]);

  useEffect(() => { void load(); }, [load]);

  const readinessCards = useMemo(() => {
    if (!readiness) return [];
    return [
      ["Software completion", `${readiness.softwarePercent ?? 0}%`, readiness.softwareComplete],
      ["External certification", readiness.externalCertificationComplete ? "Complete" : "Pending", readiness.externalCertificationComplete],
      ["Privacy configured", readiness.privacyConfigured ? "Complete" : "Pending", readiness.privacyConfigured],
      ["Production activation", readiness.productionActivationReady ? "READY" : "BLOCKED", readiness.productionActivationReady],
    ];
  }, [readiness]);

  async function createPolicy() {
    setError(""); setNotice("");
    try {
      await api("/connected-campus/governance/retention-policies", {
        method:"POST",
        body:JSON.stringify({
          branchId: policyForm.branchId || undefined,
          purpose: policyForm.purpose,
          subjectType: policyForm.subjectType || undefined,
          retentionDays:Number(policyForm.retentionDays),
          action:policyForm.action,
          legalBasis:String(policyForm.legalBasis).trim(),
          policyVersion:String(policyForm.policyVersion).trim(),
        }),
      });
      setNotice("Retention policy approved and previous matching active policy retired.");
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function createCertification() {
    setError(""); setNotice("");
    try {
      let evidence: Row;
      try { evidence = JSON.parse(String(certForm.evidence || "{}")); }
      catch { throw new Error("Certification evidence must be valid JSON."); }
      await api("/connected-campus/governance/certifications", {
        method:"POST",
        body:JSON.stringify({
          capabilityKey:String(certForm.capabilityKey).trim(),
          kind:certForm.kind,
          environment:certForm.environment,
          adapterKey:certForm.adapterKey || undefined,
          deviceId:certForm.deviceId || undefined,
          benchmarkRunId:certForm.benchmarkRunId || undefined,
          vendor:String(certForm.vendor || "").trim() || undefined,
          hardwareModel:String(certForm.hardwareModel || "").trim() || undefined,
          firmwareVersion:String(certForm.firmwareVersion || "").trim() || undefined,
          protocolVersion:String(certForm.protocolVersion || "").trim() || undefined,
          evidence,
          testedAt:certForm.testedAt ? new Date(certForm.testedAt).toISOString() : undefined,
          expiresAt:certForm.expiresAt ? new Date(certForm.expiresAt).toISOString() : undefined,
        }),
      });
      setNotice("Certification evidence submitted for review.");
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function reviewCertification(id: string, status: "PASSED" | "FAILED") {
    const notes = window.prompt(`${status === "PASSED" ? "Approval" : "Failure"} notes`);
    if (!notes?.trim()) return;
    try {
      await api(`/connected-campus/governance/certifications/${id}/review`, { method:"PATCH", body:JSON.stringify({ status, notes:notes.trim() }) });
      setNotice(`Certification ${status.toLowerCase()}.`);
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function updateRequest(row: Row, status: string) {
    const terminal = status === "COMPLETED" || status === "REJECTED";
    const text = terminal ? window.prompt(status === "COMPLETED" ? "Result/evidence reference" : "Rejection reason") : "";
    if (terminal && !text?.trim()) return;
    try {
      await api(`/connected-campus/governance/data-requests/${row.id}`, {
        method:"PATCH",
        body:JSON.stringify({
          status,
          ...(status === "COMPLETED" ? { resultRef:text!.trim() } : {}),
          ...(status === "REJECTED" ? { rejectionReason:text!.trim() } : {}),
        }),
      });
      setNotice(`Privacy request moved to ${status}.`);
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
  }

  return <ProtectedAdminWorkspace title="Connected Campus" description="Device, safety, privacy and ERP 3.1 release governance.">
    <div className="mt-6 flex flex-wrap gap-2">
      {["readiness","privacy","requests","certifications"].map(name => <button key={name} onClick={()=>setTab(name)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab===name?"bg-brand-700 text-white":"border bg-white dark:bg-slate-900"}`}>{name}</button>)}
      <button onClick={()=>void load()} disabled={loading} className="ml-auto inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold dark:bg-slate-900"><RefreshCw size={16} className={loading?"animate-spin":""}/>Refresh</button>
    </div>
    {error&&<p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice&&<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

    {tab==="readiness"&&<section className="mt-6">
      {!superAdmin&&<div className="card p-5"><p className="font-bold">Organization-wide readiness is Super Admin only.</p><p className="mt-1 text-sm text-slate-500">Branch administrators can manage branch privacy operations and submit certification evidence from the other tabs.</p></div>}
      {superAdmin&&readiness&&<>
        <div className="grid gap-4 md:grid-cols-4">{readinessCards.map(([label,value,good])=><div key={String(label)} className="card p-5"><div className={`grid h-10 w-10 place-items-center rounded-xl ${good?"bg-emerald-50 text-emerald-700":"bg-amber-50 text-amber-700"}`}>{good?<BadgeCheck size={20}/>:<TriangleAlert size={20}/>}</div><p className="mt-3 text-xs uppercase text-slate-400">{String(label)}</p><b className="text-lg">{String(value)}</b></div>)}</div>
        <div className="card mt-5 p-5"><h2 className="font-black">Release blockers</h2>{readiness.blockers?.length?<div className="mt-3 space-y-2">{readiness.blockers.map((blocker:Row,index:number)=><div key={index} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><b>{blocker.type}</b> · {blocker.key}<p className="mt-1 text-slate-600">{blocker.message}</p></div>)}</div>:<p className="mt-3 text-sm text-emerald-700">No 3.1 production-activation blockers remain.</p>}</div>
        <div className="card mt-5 p-5"><h2 className="font-black">Operational snapshot</h2><pre className="mt-3 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(readiness.operational,null,2)}</pre></div>
      </>}
    </section>}

    {tab==="privacy"&&<section className="mt-6 grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="card p-5"><div className="flex items-center gap-2"><FileLock2 className="text-brand-700"/><h2 className="font-black">New retention policy</h2></div>
        <div className="mt-4 space-y-3">
          <select className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={policyForm.branchId} onChange={e=>setPolicyForm({...policyForm,branchId:e.target.value})}><option value="">Organization scope</option>{branches.map(branch=><option key={branch.id} value={branch.id}>{branch.branchName??branch.name??branch.id}</option>)}</select>
          <select className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={policyForm.purpose} onChange={e=>setPolicyForm({...policyForm,purpose:e.target.value})}>{purposes.map(x=><option key={x}>{x}</option>)}</select>
          <select className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={policyForm.subjectType} onChange={e=>setPolicyForm({...policyForm,subjectType:e.target.value})}><option value="">All subject types</option>{["STUDENT","GUARDIAN","EMPLOYEE","VISITOR"].map(x=><option key={x}>{x}</option>)}</select>
          <input className="w-full rounded-xl border p-2.5 dark:bg-slate-900" type="number" min={1} max={36500} value={policyForm.retentionDays} onChange={e=>setPolicyForm({...policyForm,retentionDays:e.target.value})} placeholder="Retention days"/>
          <select className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={policyForm.action} onChange={e=>setPolicyForm({...policyForm,action:e.target.value})}>{retentionActions.map(x=><option key={x}>{x}</option>)}</select>
          <input className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={policyForm.policyVersion} onChange={e=>setPolicyForm({...policyForm,policyVersion:e.target.value})} placeholder="Policy version"/>
          <textarea className="w-full rounded-xl border p-2.5 dark:bg-slate-900" rows={4} value={policyForm.legalBasis} onChange={e=>setPolicyForm({...policyForm,legalBasis:e.target.value})} placeholder="Legal / operational basis"/>
          <button onClick={()=>void createPolicy()} className="w-full rounded-xl bg-brand-700 px-4 py-2.5 font-bold text-white">Approve policy</button>
        </div>
      </div>
      <div className="card overflow-hidden"><div className="border-b p-4"><h2 className="font-black">Retention policy history</h2></div><div className="divide-y">{policies.map(row=><div key={row.id} className="grid gap-2 p-4 text-sm md:grid-cols-5"><span><small className="block text-slate-400">Purpose</small>{row.purpose}</span><span><small className="block text-slate-400">Scope</small>{row.branchId?"Branch":"Organization"}</span><span><small className="block text-slate-400">Retention</small>{row.retentionDays} days</span><span><small className="block text-slate-400">Action</small>{row.action}</span><span><small className="block text-slate-400">State</small>{row.isActive?"ACTIVE":"HISTORICAL"}</span></div>)}{!policies.length&&<p className="p-6 text-sm text-slate-500">No retention policies configured yet.</p>}</div></div>
    </section>}

    {tab==="requests"&&<section className="card mt-6 overflow-hidden"><div className="border-b p-4"><h2 className="font-black">Data-subject requests</h2></div><div className="divide-y">{requests.map(row=><div key={row.id} className="p-4"><div className="grid gap-2 text-sm md:grid-cols-5"><span><small className="block text-slate-400">Type</small>{row.type}</span><span><small className="block text-slate-400">Subject</small>{row.subjectType}</span><span><small className="block text-slate-400">Status</small>{row.status}</span><span><small className="block text-slate-400">Created</small>{new Date(row.createdAt).toLocaleString()}</span><span className="flex flex-wrap gap-1">{row.status==="REQUESTED"&&<button onClick={()=>void updateRequest(row,"VERIFIED")} className="rounded-lg border px-2 py-1">Verify</button>}{row.status==="VERIFIED"&&<button onClick={()=>void updateRequest(row,"IN_PROGRESS")} className="rounded-lg border px-2 py-1">Start</button>}{row.status==="IN_PROGRESS"&&<button onClick={()=>void updateRequest(row,"COMPLETED")} className="rounded-lg bg-emerald-600 px-2 py-1 text-white">Complete</button>}{["REQUESTED","VERIFIED","IN_PROGRESS"].includes(row.status)&&<button onClick={()=>void updateRequest(row,"REJECTED")} className="rounded-lg bg-red-600 px-2 py-1 text-white">Reject</button>}</span></div></div>)}{!requests.length&&<p className="p-6 text-sm text-slate-500">No privacy requests.</p>}</div></section>}

    {tab==="certifications"&&<section className="mt-6 grid gap-5 lg:grid-cols-[420px_1fr]">
      <div className="card p-5"><div className="flex items-center gap-2"><ShieldCheck className="text-brand-700"/><h2 className="font-black">Certification evidence</h2></div><div className="mt-4 space-y-3">
        <input className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={certForm.capabilityKey} onChange={e=>setCertForm({...certForm,capabilityKey:e.target.value})} placeholder="Capability key e.g. gps.vendor-x"/>
        <select className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={certForm.kind} onChange={e=>setCertForm({...certForm,kind:e.target.value})}>{certificationKinds.map(x=><option key={x}>{x}</option>)}</select>
        <select className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={certForm.environment} onChange={e=>setCertForm({...certForm,environment:e.target.value})}>{certificationEnvironments.map(x=><option key={x}>{x}</option>)}</select>
        <select className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={certForm.deviceId} onChange={e=>setCertForm({...certForm,deviceId:e.target.value})}><option value="">No Device Hub device</option>{devices.map(device=><option key={device.id} value={device.id}>{device.code??device.name??device.id}</option>)}</select>
        <select className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={certForm.adapterKey} onChange={e=>setCertForm({...certForm,adapterKey:e.target.value})}><option value="">No adapter</option>{adapters.map(adapter=><option key={adapter.key} value={adapter.key}>{adapter.name??adapter.key}</option>)}</select>
        <input className="w-full rounded-xl border p-2.5 dark:bg-slate-900" value={certForm.benchmarkRunId} onChange={e=>setCertForm({...certForm,benchmarkRunId:e.target.value})} placeholder="AI benchmark run ID (AI grading only)"/>
        <div className="grid grid-cols-2 gap-2"><input className="rounded-xl border p-2.5 dark:bg-slate-900" value={certForm.vendor} onChange={e=>setCertForm({...certForm,vendor:e.target.value})} placeholder="Vendor"/><input className="rounded-xl border p-2.5 dark:bg-slate-900" value={certForm.hardwareModel} onChange={e=>setCertForm({...certForm,hardwareModel:e.target.value})} placeholder="Hardware model"/></div>
        <div className="grid grid-cols-2 gap-2"><input className="rounded-xl border p-2.5 dark:bg-slate-900" value={certForm.firmwareVersion} onChange={e=>setCertForm({...certForm,firmwareVersion:e.target.value})} placeholder="Firmware"/><input className="rounded-xl border p-2.5 dark:bg-slate-900" value={certForm.protocolVersion} onChange={e=>setCertForm({...certForm,protocolVersion:e.target.value})} placeholder="Protocol"/></div>
        <label className="text-xs text-slate-500">Tested at<input className="mt-1 w-full rounded-xl border p-2.5 dark:bg-slate-900" type="datetime-local" value={certForm.testedAt} onChange={e=>setCertForm({...certForm,testedAt:e.target.value})}/></label>
        <textarea className="w-full rounded-xl border p-2.5 font-mono text-xs dark:bg-slate-900" rows={5} value={certForm.evidence} onChange={e=>setCertForm({...certForm,evidence:e.target.value})} placeholder='{"realDevice":true,"testReport":"..."}'/>
        <button onClick={()=>void createCertification()} className="w-full rounded-xl bg-brand-700 px-4 py-2.5 font-bold text-white">Submit evidence</button>
      </div></div>
      <div className="card overflow-hidden"><div className="border-b p-4"><h2 className="font-black">Certification history</h2></div><div className="divide-y">{certifications.map(row=><div key={row.id} className="p-4 text-sm"><div className="grid gap-2 md:grid-cols-5"><span><small className="block text-slate-400">Capability</small>{row.capabilityKey}</span><span><small className="block text-slate-400">Kind</small>{row.kind}</span><span><small className="block text-slate-400">Environment</small>{row.environment}</span><span><small className="block text-slate-400">Status</small>{row.status}</span><span className="flex gap-1">{superAdmin&&["DRAFT","IN_REVIEW"].includes(row.status)&&<><button onClick={()=>void reviewCertification(row.id,"PASSED")} className="rounded-lg bg-emerald-600 px-2 py-1 text-white">Pass</button><button onClick={()=>void reviewCertification(row.id,"FAILED")} className="rounded-lg bg-red-600 px-2 py-1 text-white">Fail</button></>}</span></div></div>)}{!certifications.length&&<p className="p-6 text-sm text-slate-500">No certification evidence submitted.</p>}</div></div>
    </section>}
  </ProtectedAdminWorkspace>;
}
