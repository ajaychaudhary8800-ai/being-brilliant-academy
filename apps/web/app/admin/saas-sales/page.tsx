"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, CalendarClock, CheckCircle2, Filter, Plus, Search, Target, TrendingUp, X } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const statuses = ["NEW","QUALIFIED","CONTACTED","DEMO_SCHEDULED","DEMO_COMPLETED","PROPOSAL_SENT","NEGOTIATION","WON","LOST","NURTURE"];
const qualifications = ["UNQUALIFIED","MQL","SQL","DISQUALIFIED"];
const sources = ["WEBSITE","REFERRAL","CBSE_DIRECTORY","CISCE_DIRECTORY","GOOGLE_MAPS","LINKEDIN","SAHODAYA","PARTNER","OUTBOUND","EVENT","OTHER"];
const plans = ["ESSENTIALS","GROWTH","PROFESSIONAL","ENTERPRISE"];

type Activity = { id:string; activityType:string; outcome:string|null; notes:string|null; nextFollowUpAt:string|null; createdAt:string };
type Lead = {
  id:string; organizationName:string; contactName:string; mobile:string; email:string|null; institutionType:string;
  studentCountBand:string|null; city:string|null; state:string|null; website:string|null; source:string; campaign:string|null;
  status:string; qualification:string; leadScore:number; recommendedPlan:string|null; expectedAnnualValuePaise:number|null;
  nextFollowUpAt:string|null; lastContactAt:string|null; ownerUserId:string|null; notes:string|null; lostReason:string|null;
  wonOrganizationId:string|null; requirements:string[]|null; createdAt:string; updatedAt:string; activities:Activity[];
};
type Dashboard = {
  total:number; new:number; qualified:number; demos:number; proposals:number; negotiation:number; won:number; lost:number;
  overdue:number; dueSoon:number; createdThisWeek:number; winRate:number; bySource:{source:string;count:number}[];
};

const headers = () => ({ "Content-Type":"application/json", Authorization:`Bearer ${getAccessToken() ?? ""}` });
async function api(path:string, init?:RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, headers:{...headers(), ...init?.headers} });
  const json = await response.json().catch(()=>null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}
const money = (paise:number|null) => paise == null ? "—" : new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(paise/100);
const label = (value:string) => value.toLowerCase().replaceAll("_"," ").replace(/\b\w/g, c=>c.toUpperCase());
const localInput = (iso:string|null) => iso ? new Date(new Date(iso).getTime()-new Date(iso).getTimezoneOffset()*60000).toISOString().slice(0,16) : "";

export default function Page() {
  const [dashboard,setDashboard] = useState<Dashboard|null>(null);
  const [leads,setLeads] = useState<Lead[]>([]);
  const [meta,setMeta] = useState({total:0,page:1,totalPages:1});
  const [search,setSearch] = useState("");
  const [status,setStatus] = useState("");
  const [source,setSource] = useState("");
  const [followUp,setFollowUp] = useState("");
  const [page,setPage] = useState(1);
  const [selected,setSelected] = useState<Lead|null>(null);
  const [mode,setMode] = useState<"lead"|"activity"|"new"|null>(null);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);

  const query = useMemo(()=>{
    const p=new URLSearchParams({page:String(page),limit:"25"});
    if(search)p.set("search",search); if(status)p.set("status",status); if(source)p.set("source",source); if(followUp)p.set("followUp",followUp);
    return p.toString();
  },[page,search,status,source,followUp]);

  const load = useCallback(async()=>{
    try {
      const [d,l]=await Promise.all([api("/platform/sales/dashboard"),api(`/platform/sales/leads?${query}`)]);
      setDashboard(d.data); setLeads(l.data); setMeta({total:l.meta.total,page:l.meta.page,totalPages:l.meta.totalPages}); setError("");
    } catch(cause) { setError(errorMessage(cause)); }
  },[query]);
  useEffect(()=>{void load();},[load]);

  async function createLead(form:HTMLFormElement) {
    const fd=new FormData(form);
    const payload={
      organizationName:String(fd.get("organizationName")??"").trim(),
      contactName:String(fd.get("contactName")??"").trim(),
      mobile:String(fd.get("mobile")??"").trim(),
      email:String(fd.get("email")??"").trim(),
      institutionType:String(fd.get("institutionType")??"School"),
      studentCountBand:String(fd.get("studentCountBand")??""),
      city:String(fd.get("city")??"").trim(),
      state:String(fd.get("state")??"").trim(),
      website:String(fd.get("website")??"").trim(),
      source:String(fd.get("source")??"OUTBOUND"),
      notes:String(fd.get("notes")??"").trim(),
      nextFollowUpAt:fd.get("nextFollowUpAt")?new Date(String(fd.get("nextFollowUpAt"))).toISOString():undefined,
    };
    await api("/platform/sales/leads",{method:"POST",body:JSON.stringify(payload)});
  }

  async function saveLead(form:HTMLFormElement) {
    if(!selected)return;
    const fd=new FormData(form);
    const nextFollowUpAt=String(fd.get("nextFollowUpAt")??"");
    const expected=String(fd.get("expectedAnnualValue")??"").replace(/[^0-9.]/g,"");
    await api(`/platform/sales/leads/${selected.id}`,{method:"PATCH",body:JSON.stringify({
      status:String(fd.get("status")),
      qualification:String(fd.get("qualification")),
      recommendedPlan:String(fd.get("recommendedPlan"))||null,
      expectedAnnualValuePaise:expected?Math.round(Number(expected)*100):null,
      nextFollowUpAt:nextFollowUpAt?new Date(nextFollowUpAt).toISOString():null,
      notes:String(fd.get("notes")??"").trim()||null,
      lostReason:String(fd.get("lostReason")??"").trim()||null,
      wonOrganizationId:String(fd.get("wonOrganizationId")??"").trim()||null,
    })});
  }

  async function addActivity(form:HTMLFormElement) {
    if(!selected)return;
    const fd=new FormData(form);
    const next=String(fd.get("nextFollowUpAt")??"");
    await api(`/platform/sales/leads/${selected.id}/activities`,{method:"POST",body:JSON.stringify({
      activityType:String(fd.get("activityType")),
      outcome:String(fd.get("outcome")??"").trim()||undefined,
      notes:String(fd.get("notes")??"").trim()||undefined,
      nextFollowUpAt:next?new Date(next).toISOString():undefined,
      status:String(fd.get("status")??"")||undefined,
    })});
  }

  async function submit(event:React.FormEvent<HTMLFormElement>,action:(form:HTMLFormElement)=>Promise<void>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await action(event.currentTarget); setMode(null); setNotice("Sales pipeline updated."); await load(); }
    catch(cause){setError(errorMessage(cause));}
    finally{setBusy(false);}
  }

  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="SaaS Sales" description="Platform client acquisition pipeline: qualify institutions, schedule demos, send proposals, manage follow-ups and close paying clients.">
    <div className="my-6 flex flex-wrap justify-end gap-2">
      <button onClick={()=>{setSelected(null);setMode("new")}} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 font-semibold text-white"><Plus size={17}/>Add target account</button>
    </div>
    {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice&&<p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      <Metric label="Total leads" value={dashboard?.total??0} icon={<BriefcaseBusiness size={18}/>}/>
      <Metric label="New this week" value={dashboard?.createdThisWeek??0} icon={<TrendingUp size={18}/>}/>
      <Metric label="Qualified" value={dashboard?.qualified??0} icon={<Target size={18}/>}/>
      <Metric label="Demos" value={dashboard?.demos??0} icon={<CalendarClock size={18}/>}/>
      <Metric label="Won" value={dashboard?.won??0} icon={<CheckCircle2 size={18}/>}/>
      <Metric label="Win rate" value={`${dashboard?.winRate??0}%`} icon={<TrendingUp size={18}/>}/>
    </section>

    <section className="mt-4 grid gap-3 lg:grid-cols-[1fr_320px]">
      <div className="card p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="relative"><Search className="absolute left-3 top-3" size={16}/><input aria-label="Search leads" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Institution, contact, city..." className="field pl-9"/></label>
          <Select value={status} onChange={v=>{setStatus(v);setPage(1)}} label="All stages" options={statuses}/>
          <Select value={source} onChange={v=>{setSource(v);setPage(1)}} label="All sources" options={sources}/>
          <Select value={followUp} onChange={v=>{setFollowUp(v);setPage(1)}} label="All follow-ups" options={["overdue","upcoming"]}/>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <button onClick={()=>{setFollowUp("overdue");setPage(1)}} className="rounded-lg border px-3 py-2">Overdue: <b>{dashboard?.overdue??0}</b></button>
          <button onClick={()=>{setFollowUp("upcoming");setPage(1)}} className="rounded-lg border px-3 py-2">Due in 48h: <b>{dashboard?.dueSoon??0}</b></button>
          <button onClick={()=>{setSearch("");setStatus("");setSource("");setFollowUp("");setPage(1)}} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2"><Filter size={15}/>Clear</button>
        </div>
      </div>
      <div className="card p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Top lead sources</p>
        <div className="mt-3 space-y-2 text-sm">{(dashboard?.bySource??[]).slice(0,5).map(item=><div key={item.source} className="flex justify-between"><span>{label(item.source)}</span><b>{item.count}</b></div>)}
        {(dashboard?.bySource?.length??0)===0&&<span className="text-slate-500">No source data yet.</span>}</div>
      </div>
    </section>

    <section className="card mt-5 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:bg-slate-900"><tr>
            <th className="p-3">Institution</th><th className="p-3">Contact</th><th className="p-3">Source</th><th className="p-3">Score</th>
            <th className="p-3">Qualification</th><th className="p-3">Stage</th><th className="p-3">Plan</th><th className="p-3">Value</th>
            <th className="p-3">Next follow-up</th><th className="p-3">Actions</th>
          </tr></thead>
          <tbody>{leads.map(lead=><tr key={lead.id} className="border-t">
            <td className="p-3 align-top"><b>{lead.organizationName}</b><br/><span className="text-xs text-slate-500">{lead.institutionType}{lead.studentCountBand?` · ${lead.studentCountBand}`:""}{lead.city?` · ${lead.city}`:""}</span></td>
            <td className="p-3 align-top">{lead.contactName}<br/><span className="text-xs">{lead.mobile}{lead.email?<><br/>{lead.email}</>:null}</span></td>
            <td className="p-3 align-top">{label(lead.source)}</td><td className="p-3 align-top font-bold">{lead.leadScore}</td>
            <td className="p-3 align-top">{label(lead.qualification)}</td><td className="p-3 align-top">{label(lead.status)}</td>
            <td className="p-3 align-top">{lead.recommendedPlan?label(lead.recommendedPlan):"—"}</td><td className="p-3 align-top">{money(lead.expectedAnnualValuePaise)}</td>
            <td className="p-3 align-top">{lead.nextFollowUpAt?new Date(lead.nextFollowUpAt).toLocaleString("en-IN"):"—"}</td>
            <td className="p-3 align-top"><div className="flex gap-2"><button onClick={()=>{setSelected(lead);setMode("lead")}} className="text-brand-700 font-semibold">Manage</button><button onClick={()=>{setSelected(lead);setMode("activity")}} className="text-brand-700 font-semibold">Log activity</button></div></td>
          </tr>)}
          {leads.length===0&&<tr><td colSpan={10} className="p-12 text-center text-slate-500">No platform sales leads match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between border-t p-4 text-sm"><span>{meta.total} leads</span><div className="flex items-center gap-2"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button><span>{page}/{meta.totalPages}</span><button disabled={page>=meta.totalPages} onClick={()=>setPage(p=>p+1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button></div></footer>
    </section>

    {mode&&<div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4"><div className="mx-auto my-8 max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-950">
      <button aria-label="Close" onClick={()=>setMode(null)} className="float-right rounded-lg p-2"><X/></button>
      {mode==="new"?<NewLeadForm busy={busy} onSubmit={e=>void submit(e,createLead)}/>:mode==="activity"&&selected?<ActivityForm lead={selected} busy={busy} onSubmit={e=>void submit(e,addActivity)}/>:selected?<LeadForm lead={selected} busy={busy} onSubmit={e=>void submit(e,saveLead)}/>:null}
    </div></div>}
    <style jsx global>{`.field{width:100%;min-height:44px;border:1px solid #cbd5e1;border-radius:.75rem;padding:.65rem .8rem;background:white}.field:focus{outline:2px solid #1d4ed8;outline-offset:1px}.dark .field{background:#0f172a;border-color:#334155}`}</style>
  </ProtectedAdminWorkspace>;
}

function Metric({label,value,icon}:{label:string;value:string|number;icon:React.ReactNode}) { return <div className="card p-4"><div className="flex items-center gap-2 text-brand-700">{icon}<span className="text-xs font-bold uppercase tracking-wider">{label}</span></div><p className="mt-3 text-2xl font-black">{value}</p></div>; }
function Select({value,onChange,label:placeholder,options}:{value:string;onChange:(v:string)=>void;label:string;options:string[]}) { return <label><span className="sr-only">{placeholder}</span><select className="field" value={value} onChange={e=>onChange(e.target.value)}><option value="">{placeholder}</option>{options.map(x=><option key={x} value={x}>{label(x)}</option>)}</select></label>; }

function NewLeadForm({busy,onSubmit}:{busy:boolean;onSubmit:(e:React.FormEvent<HTMLFormElement>)=>void}) {
  return <form onSubmit={onSubmit}><h2 className="text-2xl font-bold">Add target account</h2><p className="mt-1 text-sm text-slate-500">Use public institutional/business contact information only.</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <Input name="organizationName" labelText="Institution / organization" required/><Input name="contactName" labelText="Contact name" required/>
      <Input name="mobile" labelText="Mobile" required/><Input name="email" type="email" labelText="Email"/>
      <label className="text-sm font-semibold">Institution type<select name="institutionType" className="field mt-1"><option>School</option><option>Coaching Institute</option><option>Training Institute</option><option>Education Group</option><option>Other</option></select></label>
      <label className="text-sm font-semibold">Students<select name="studentCountBand" className="field mt-1"><option>Under 500</option><option>500–2,000</option><option>2,000–5,000</option><option>5,000+</option></select></label>
      <Input name="city" labelText="City"/><Input name="state" labelText="State"/>
      <Input name="website" type="url" labelText="Website"/>
      <label className="text-sm font-semibold">Source<select name="source" className="field mt-1">{sources.map(x=><option key={x} value={x}>{label(x)}</option>)}</select></label>
      <Input name="nextFollowUpAt" type="datetime-local" labelText="First follow-up"/>
      <label className="text-sm font-semibold sm:col-span-2">Notes<textarea name="notes" className="field mt-1 min-h-24"/></label>
    </div><button disabled={busy} className="mt-5 rounded-xl bg-brand-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy?"Saving…":"Add lead"}</button>
  </form>;
}

function LeadForm({lead,busy,onSubmit}:{lead:Lead;busy:boolean;onSubmit:(e:React.FormEvent<HTMLFormElement>)=>void}) {
  return <form onSubmit={onSubmit}><h2 className="text-2xl font-bold">{lead.organizationName}</h2><p className="mt-1 text-sm text-slate-500">Score {lead.leadScore} · {label(lead.source)} · created {new Date(lead.createdAt).toLocaleDateString("en-IN")}</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">Stage<select name="status" defaultValue={lead.status} className="field mt-1">{statuses.map(x=><option key={x}>{x}</option>)}</select></label>
      <label className="text-sm font-semibold">Qualification<select name="qualification" defaultValue={lead.qualification} className="field mt-1">{qualifications.map(x=><option key={x}>{x}</option>)}</select></label>
      <label className="text-sm font-semibold">Recommended plan<select name="recommendedPlan" defaultValue={lead.recommendedPlan??""} className="field mt-1"><option value="">—</option>{plans.map(x=><option key={x}>{x}</option>)}</select></label>
      <Input name="expectedAnnualValue" type="number" labelText="Expected annual value (₹)" defaultValue={lead.expectedAnnualValuePaise==null?"":String(lead.expectedAnnualValuePaise/100)}/>
      <Input name="nextFollowUpAt" type="datetime-local" labelText="Next follow-up" defaultValue={localInput(lead.nextFollowUpAt)}/>
      <Input name="wonOrganizationId" labelText="Won customer organization ID" defaultValue={lead.wonOrganizationId??""}/>
      <label className="text-sm font-semibold sm:col-span-2">Lost reason<textarea name="lostReason" defaultValue={lead.lostReason??""} className="field mt-1 min-h-20"/></label>
      <label className="text-sm font-semibold sm:col-span-2">Notes<textarea name="notes" defaultValue={lead.notes??""} className="field mt-1 min-h-28"/></label>
    </div>
    {lead.activities?.length>0&&<div className="mt-5 rounded-xl border p-4"><h3 className="font-bold">Recent activity</h3><div className="mt-3 space-y-3 text-sm">{lead.activities.map(a=><div key={a.id}><b>{label(a.activityType)}</b> · {new Date(a.createdAt).toLocaleString("en-IN")}<br/><span className="text-slate-500">{a.outcome??a.notes??"No note"}</span></div>)}</div></div>}
    <button disabled={busy} className="mt-5 rounded-xl bg-brand-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy?"Saving…":"Save lead"}</button>
  </form>;
}

function ActivityForm({lead,busy,onSubmit}:{lead:Lead;busy:boolean;onSubmit:(e:React.FormEvent<HTMLFormElement>)=>void}) {
  return <form onSubmit={onSubmit}><h2 className="text-2xl font-bold">Log activity</h2><p className="mt-1 text-sm text-slate-500">{lead.organizationName} · {lead.contactName}</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">Activity<select name="activityType" className="field mt-1">{["CALL","EMAIL","WHATSAPP","MEETING","DEMO","PROPOSAL","NOTE"].map(x=><option key={x}>{x}</option>)}</select></label>
      <label className="text-sm font-semibold">Move stage to<select name="status" defaultValue={lead.status} className="field mt-1">{statuses.map(x=><option key={x}>{x}</option>)}</select></label>
      <Input name="outcome" labelText="Outcome"/>
      <Input name="nextFollowUpAt" type="datetime-local" labelText="Next follow-up"/>
      <label className="text-sm font-semibold sm:col-span-2">Notes<textarea name="notes" className="field mt-1 min-h-28"/></label>
    </div><button disabled={busy} className="mt-5 rounded-xl bg-brand-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy?"Saving…":"Save activity"}</button>
  </form>;
}

function Input({name,labelText,type="text",required=false,defaultValue}:{name:string;labelText:string;type?:string;required?:boolean;defaultValue?:string}) { return <label className="text-sm font-semibold">{labelText}<input name={name} type={type} required={required} defaultValue={defaultValue} className="field mt-1"/></label>; }
