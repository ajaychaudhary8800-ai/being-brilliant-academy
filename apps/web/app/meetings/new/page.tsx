"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { AuthGate, errorMessage, getAccessToken } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Branch={id:string;branchName:string;branchCode:string}; type Department={id:string;name:string;code:string};
type User={id:string;name:string;email:string;role:string;branchIds:string[];departmentId:string|null};
type Options={branches:Branch[];departments:Department[];users:User[];canCreate:boolean;canOrganizationWide:boolean};
type Agenda={title:string;plannedMinutes:string};

async function request(path:string,init?:RequestInit){const response=await fetch(`${API}${path}`,{...init,headers:{Authorization:`Bearer ${getAccessToken()??""}`,...(init?.body?{"Content-Type":"application/json"}:{})}});const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(body?.error?.message??"Request failed");return body}
const localInput=(date:Date)=>{const off=date.getTimezoneOffset();return new Date(date.getTime()-off*60000).toISOString().slice(0,16)};

function Content(){
  const router=useRouter();
  const [options,setOptions]=useState<Options|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const start=useMemo(()=>{const d=new Date(Date.now()+3600000);d.setMinutes(Math.ceil(d.getMinutes()/15)*15,0,0);return localInput(d)},[]);
  const end=useMemo(()=>{const d=new Date(new Date(start).getTime()+3600000);return localInput(d)},[start]);
  const [form,setForm]=useState({title:"",description:"",type:"STAFF",branchId:"",departmentId:"",startsAt:start,endsAt:end,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"Asia/Kolkata",visibility:"INVITE_ONLY",allowRecording:false,recordingRequired:false,allowChat:true,allowWhiteboard:true,allowAnnotation:true,allowScreenShare:true,allowParticipantMic:true,allowParticipantCamera:true,joinBeforeMinutes:15,lockAfterStart:false,recurrence:"NONE",recurrenceCount:8});
  const [participants,setParticipants]=useState<string[]>([]),[cohosts,setCohosts]=useState<string[]>([]),[presenters,setPresenters]=useState<string[]>([]),[agenda,setAgenda]=useState<Agenda[]>([{title:"",plannedMinutes:""}]);

  useEffect(()=>{request("/meetings/options").then(r=>setOptions(r.data)).catch(c=>setError(errorMessage(c)))},[]);
  const visibleUsers=(options?.users??[]).filter(user=>!form.branchId||user.branchIds.includes(form.branchId));
  const toggle=(setter:React.Dispatch<React.SetStateAction<string[]>>,id:string)=>setter(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);
  const submit=async(event:FormEvent)=>{event.preventDefault();setSaving(true);setError("");try{
    const recurrenceRule=form.recurrence==="NONE"?null:`FREQ=${form.recurrence};INTERVAL=1;COUNT=${form.recurrenceCount}`;
    const body={...form,branchId:form.branchId||null,departmentId:form.departmentId||null,startsAt:new Date(form.startsAt).toISOString(),endsAt:new Date(form.endsAt).toISOString(),participantUserIds:participants,coHostUserIds:cohosts,presenterUserIds:presenters,agenda:agenda.filter(x=>x.title.trim()).map(x=>({title:x.title.trim(),plannedMinutes:x.plannedMinutes?Number(x.plannedMinutes):null})),recurrenceRule,recurrenceEnd:null};
    delete (body as any).recurrence;delete (body as any).recurrenceCount;
    const result=await request("/meetings",{method:"POST",body:JSON.stringify(body)});router.push(`/meetings/${result.data.id}`);
  }catch(cause){setError(errorMessage(cause))}finally{setSaving(false)}};

  return <main className="min-h-screen bg-slate-50 p-5 dark:bg-slate-950 md:p-10"><div className="mx-auto max-w-6xl">
    <Link href="/meetings" className="text-sm font-bold text-brand-700">← Meetings</Link>
    <h1 className="mt-4 text-3xl font-black">Schedule Staff / Management Meeting</h1><p className="mt-2 text-sm text-slate-500">Creates an enterprise meeting record. It does not create a LiveClass.</p>
    {error&&<p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {!options?<div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin text-brand-700"/></div>:!options.canCreate?<p className="mt-6 rounded-xl bg-amber-50 p-4">Your role can attend meetings but cannot schedule them.</p>:<form onSubmit={submit} className="mt-7 space-y-6">
      <section className="rounded-2xl border bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-lg font-black">1. Details & scope</h2><div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="md:col-span-2 text-sm font-semibold">Title<input required minLength={3} className="field mt-1" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
        <label className="md:col-span-2 text-sm font-semibold">Description<textarea rows={3} className="field mt-1" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
        <label className="text-sm font-semibold">Meeting type<select className="field mt-1" value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{["MANAGEMENT","STAFF","DEPARTMENT","HOD","TEACHER_COORDINATION","TRAINING","INTERVIEW","COMMITTEE","GENERAL","CUSTOM"].map(x=><option key={x}>{x}</option>)}</select></label>
        <label className="text-sm font-semibold">Visibility<select className="field mt-1" value={form.visibility} onChange={e=>setForm({...form,visibility:e.target.value})}><option>INVITE_ONLY</option>{options.canOrganizationWide&&<option>ORGANIZATION</option>}<option>BRANCH</option><option>DEPARTMENT</option></select></label>
        <label className="text-sm font-semibold">Branch<select required={!options.canOrganizationWide} className="field mt-1" value={form.branchId} onChange={e=>{setForm({...form,branchId:e.target.value});setParticipants([]);setCohosts([]);setPresenters([])}}><option value="">Organization level</option>{options.branches.map(x=><option key={x.id} value={x.id}>{x.branchName} ({x.branchCode})</option>)}</select></label>
        <label className="text-sm font-semibold">Department<select className="field mt-1" value={form.departmentId} onChange={e=>setForm({...form,departmentId:e.target.value})}><option value="">All / not restricted</option>{options.departments.map(x=><option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}</select></label>
      </div></section>

      <section className="rounded-2xl border bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-lg font-black">2. Schedule</h2><div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold">Starts<input required type="datetime-local" className="field mt-1" value={form.startsAt} onChange={e=>setForm({...form,startsAt:e.target.value})}/></label>
        <label className="text-sm font-semibold">Ends<input required type="datetime-local" className="field mt-1" value={form.endsAt} onChange={e=>setForm({...form,endsAt:e.target.value})}/></label>
        <label className="text-sm font-semibold">Timezone<input required className="field mt-1" value={form.timezone} onChange={e=>setForm({...form,timezone:e.target.value})}/></label>
        <label className="text-sm font-semibold">Recurrence<select className="field mt-1" value={form.recurrence} onChange={e=>setForm({...form,recurrence:e.target.value})}><option>NONE</option><option>DAILY</option><option>WEEKLY</option><option>MONTHLY</option></select></label>
        {form.recurrence!=="NONE"&&<label className="text-sm font-semibold">Occurrences<input type="number" min={2} max={100} className="field mt-1" value={form.recurrenceCount} onChange={e=>setForm({...form,recurrenceCount:Number(e.target.value)})}/></label>}
        <label className="text-sm font-semibold">Join before (minutes)<input type="number" min={0} max={240} className="field mt-1" value={form.joinBeforeMinutes} onChange={e=>setForm({...form,joinBeforeMinutes:Number(e.target.value)})}/></label>
      </div></section>

      <section className="rounded-2xl border bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-lg font-black">3. Participants</h2><p className="mt-1 text-sm text-slate-500">Select staff. The creator becomes host unless changed later.</p><div className="mt-4 grid max-h-80 gap-2 overflow-auto md:grid-cols-2">
        {visibleUsers.map(user=><div key={user.id} className="rounded-xl border p-3"><label className="flex items-start gap-2"><input type="checkbox" checked={participants.includes(user.id)} onChange={()=>toggle(setParticipants,user.id)}/><span><b>{user.name}</b><span className="block text-xs text-slate-500">{user.role} · {user.email}</span></span></label>{participants.includes(user.id)&&<div className="mt-2 flex gap-3 pl-6 text-xs"><label><input type="checkbox" checked={cohosts.includes(user.id)} onChange={()=>toggle(setCohosts,user.id)}/> Co-host</label><label><input type="checkbox" checked={presenters.includes(user.id)} onChange={()=>toggle(setPresenters,user.id)}/> Presenter</label></div>}</div>)}
      </div></section>

      <section className="rounded-2xl border bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><h2 className="text-lg font-black">4. Agenda</h2><button type="button" className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-bold" onClick={()=>setAgenda([...agenda,{title:"",plannedMinutes:""}])}><Plus size={15}/>Item</button></div><div className="mt-4 space-y-3">{agenda.map((item,index)=><div key={index} className="grid gap-2 md:grid-cols-[1fr_150px_40px]"><input className="field" placeholder="Agenda item" value={item.title} onChange={e=>setAgenda(agenda.map((x,i)=>i===index?{...x,title:e.target.value}:x))}/><input className="field" type="number" min={1} placeholder="Minutes" value={item.plannedMinutes} onChange={e=>setAgenda(agenda.map((x,i)=>i===index?{...x,plannedMinutes:e.target.value}:x))}/><button type="button" aria-label="Remove agenda item" onClick={()=>setAgenda(agenda.filter((_,i)=>i!==index))}><Trash2 size={17}/></button></div>)}</div></section>

      <section className="rounded-2xl border bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-lg font-black">5. Meeting capabilities</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {([["allowChat","Chat"],["allowWhiteboard","Whiteboard"],["allowAnnotation","Screen annotation"],["allowScreenShare","Screen sharing"],["allowParticipantMic","Participant microphone"],["allowParticipantCamera","Participant camera"],["allowRecording","Cloud recording"],["recordingRequired","Recording required"],["lockAfterStart","Lock after host starts"]] as const).map(([key,label])=><label key={key} className="flex items-center gap-2 rounded-xl border p-3 text-sm font-semibold"><input type="checkbox" checked={Boolean(form[key])} disabled={key==="recordingRequired"&&!form.allowRecording} onChange={e=>setForm({...form,[key]:e.target.checked})}/>{label}</label>)}
      </div></section>

      <button disabled={saving} className="w-full rounded-xl bg-brand-700 px-5 py-4 font-black text-white disabled:opacity-60">{saving?<><Loader2 size={17} className="mr-2 inline animate-spin"/>Scheduling…</>:"Schedule meeting"}</button>
    </form>}
  </div><style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:transparent}`}</style></main>
}

export default function Page(){return <AuthGate roles={["SUPER_ADMIN","BRANCH_ADMIN","TEACHER","EMPLOYEE"]}><Content/></AuthGate>}
