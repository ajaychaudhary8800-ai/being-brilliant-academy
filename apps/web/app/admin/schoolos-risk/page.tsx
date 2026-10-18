"use client";

import { useCallback, useEffect, useState } from "react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

const API=process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type RiskHold={id:string;invoiceId:string;organizationId:string;status:string;revision:number;
  latestEventType:string;openedAt:string;resolvedAt:string|null};
type Review={id:string;invoiceId:string;organizationId:string;riskRevision:number;status:string;
  proposedBy:string;reviewedBy:string|null;evidenceReference:string;rationale:string;proposedAt:string};
type Data={holds:RiskHold[];reviews:Review[]};
async function api(path:string,method:"GET"|"POST"="GET",body?:unknown) {
  const response=await fetch(`${API}${path}`,{
    method,headers:{Authorization:`Bearer ${getAccessToken()??""}`,"Content-Type":"application/json"},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.error?.message??"Finance review request failed");
  return data.data;
}
export default function SchoolOSPaymentRiskPage() {
  const [data,setData]=useState<Data>({holds:[],reviews:[]});
  const [reference,setReference]=useState("");
  const [analysis,setAnalysis]=useState("");
  const [comment,setComment]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{setData(await api("/platform/schoolos/payment-risk"));},[]);
  useEffect(()=>{void refresh().catch(e=>setError(errorMessage(e)));},[refresh]);

  async function proposal(invoiceId:string){
    setBusy(true);setError("");setNotice("");
    try{
      await api("/platform/schoolos/payment-risk/reviews","POST",{
        invoiceId,evidenceReference:reference.trim(),rationale:analysis.trim(),
      });
      setNotice("Finance release submitted. A separate platform administrator must review the independently verified provider outcome.");
      await refresh();
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  async function decide(review:Review,decision:"APPROVE"|"REJECT"){
    setBusy(true);setError("");setNotice("");
    try{
      await api(`/platform/schoolos/payment-risk/reviews/${encodeURIComponent(review.id)}/decision`,"POST",{
        decision,reviewComment:comment.trim(),
      });
      setNotice(decision==="APPROVE"?"Eligible dispute-only hold resolved after independent finance approval.":"Finance review rejected; paid add-ons remain suspended.");
      await refresh();
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="SchoolOS Payment Risk" description="Independent financial review of signed refunds and disputed SaaS subscription payments. Refunds and lost disputes cannot be released.">
    {error && <p role="alert" className="mt-5 rounded-lg border border-red-400 bg-red-50 p-3 text-red-900">{error}</p>}
    {notice && <p role="status" className="mt-5 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <strong>Release policy:</strong> Only independently won payment disputes with no processed refund, lost dispute or unresolved dispute qualify for approval. A signed provider event never automatically restores licenses.
    </div>
    <section className="mt-5 rounded-xl border p-5">
      <h2 className="text-lg font-bold">Finance sign-off evidence</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold">Signed evidence reference
          <input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Case / provider reconciliation reference" className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" />
        </label>
        <label className="text-sm font-semibold">Maker analysis
          <textarea value={analysis} onChange={e=>setAnalysis(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" />
        </label>
        <label className="text-sm font-semibold">Independent reviewer explanation
          <textarea value={comment} onChange={e=>setComment(e.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-900" />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">The proposal creator cannot review their own case. Provider events added after a proposal make it stale.</p>
    </section>
    <section className="mt-5 overflow-x-auto rounded-xl border">
      <h2 className="p-4 text-lg font-bold">Provider financial-risk holds</h2>
      <table className="min-w-[850px] w-full text-left text-sm">
        <thead className="border-t"><tr><th className="p-3">Institution / Invoice</th><th className="p-3">Latest provider event</th>
          <th className="p-3">Hold</th><th className="p-3">Revision</th><th className="p-3">Action</th></tr></thead>
        <tbody>{data.holds.map(hold=><tr key={hold.id} className="border-t">
          <td className="p-3">{hold.organizationId}<span className="block text-xs text-slate-500">{hold.invoiceId}</span></td>
          <td className="p-3">{hold.latestEventType}</td><td className="p-3">{hold.status}</td>
          <td className="p-3">{hold.revision}</td><td className="p-3">
            {hold.status==="ACTIVE" && <button className="rounded border px-3 py-2 disabled:opacity-40"
              disabled={busy||reference.trim().length<12||analysis.trim().length<20}
              onClick={()=>void proposal(hold.invoiceId)}>Propose eligibility review</button>}
          </td>
        </tr>)}</tbody>
      </table>
      {!data.holds.length && <p className="p-4 text-sm text-slate-500">No signed SchoolOS payment-risk events recorded.</p>}
    </section>
    <section className="mt-5 overflow-x-auto rounded-xl border">
      <h2 className="p-4 text-lg font-bold">Independent review queue</h2>
      <table className="min-w-[850px] w-full text-left text-sm"><thead className="border-t"><tr>
        <th className="p-3">Invoice</th><th className="p-3">Revision</th><th className="p-3">Evidence</th>
        <th className="p-3">Status</th><th className="p-3">Decision</th></tr></thead>
        <tbody>{data.reviews.map(review=><tr key={review.id} className="border-t">
          <td className="p-3">{review.invoiceId}<span className="block text-xs text-slate-500">Maker: {review.proposedBy}</span></td>
          <td className="p-3">{review.riskRevision}</td><td className="p-3">{review.evidenceReference}</td>
          <td className="p-3">{review.status}</td>
          <td className="p-3">{review.status==="PENDING" &&
            <div className="flex gap-2"><button disabled={busy||comment.trim().length<20} onClick={()=>void decide(review,"APPROVE")}
              className="rounded border px-3 py-2 disabled:opacity-40">Approve</button>
              <button disabled={busy||comment.trim().length<20} onClick={()=>void decide(review,"REJECT")}
                className="rounded border px-3 py-2 disabled:opacity-40">Reject</button></div>}</td>
        </tr>)}</tbody>
      </table>
    </section>
  </ProtectedAdminWorkspace>;
}
