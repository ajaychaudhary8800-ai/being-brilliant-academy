"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { AuthGate, errorMessage, getAccessToken } from "../../../components/auth-provider";

const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000/api/v1";
type Department={id:string;name:string;code:string};
type User={id:string;name:string;email:string;role:string};
type Authority={id:string;departmentId:string;userId:string;authorityRole:string;department:Department|null;user:User|null};

async function api(path:string,init?:RequestInit){
  const response=await fetch(`${API}${path}`,{...init,headers:{Authorization:`Bearer ${getAccessToken()??""}`,...(init?.body?{"Content-Type":"application/json"}:{})}});
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(body?.error?.message??"Request failed");
  return body;
}

function Content(){
  const [departments,setDepartments]=useState<Department[]>([]);
  const [users,setUsers]=useState<User[]>([]);
  const [rows,setRows]=useState<Authority[]>([]);
  const [departmentId,setDepartmentId]=useState("");
  const [userId,setUserId]=useState("");
  const [authorityRole,setAuthorityRole]=useState("HOD");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");

  const load=useCallback(async()=>{setError("");try{
    const [options,authorities]=await Promise.all([api("/meetings/options"),api("/meetings/department-authorities")]);
    setDepartments(options.data.departments??[]);
    setUsers(options.data.users??[]);
    setRows(authorities.data??[]);
  }catch(cause){setError(errorMessage(cause))}},[]);
  useEffect(()=>{void load()},[load]);

  const save=async()=>{if(!departmentId||!userId)return;setBusy(true);setError("");setNotice("");try{
    await api("/meetings/department-authorities",{method:"POST",body:JSON.stringify({departmentId,userId,authorityRole})});
    setNotice("Department meeting authority saved.");setUserId("");await load();
  }catch(cause){setError(errorMessage(cause))}finally{setBusy(false)}};
  const revoke=async(id:string)=>{if(!confirm("Revoke this meeting authority?"))return;setBusy(true);try{
    await api(`/meetings/department-authorities/${id}`,{method:"DELETE"});setNotice("Authority revoked.");await load();
  }catch(cause){setError(errorMessage(cause))}finally{setBusy(false)}};

  return <main className="min-h-screen bg-slate-50 dark:bg-slate-950"><div className="container-page py-8">
    <Link href="/meetings" className="text-sm font-bold text-brand-700">← Meetings</Link>
    <div className="mt-4 flex items-center gap-3"><ShieldCheck className="text-brand-700"/><div><h1 className="text-3xl font-black">Department Meeting Authority</h1><p className="text-sm text-slate-500">Assign HOD or meeting-coordinator authority without changing the employee/teacher system role.</p></div></div>
    {error&&<p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}{notice&&<p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</p>}
    <section className="mt-7 rounded-2xl border bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="font-black">Assign authority</h2><div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr_220px_auto]">
      <select className="field" value={departmentId} onChange={e=>setDepartmentId(e.target.value)}><option value="">Department</option>{departments.map(x=><option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}</select>
      <select className="field" value={userId} onChange={e=>setUserId(e.target.value)}><option value="">Staff member</option>{users.map(x=><option key={x.id} value={x.id}>{x.name} · {x.role}</option>)}</select>
      <select className="field" value={authorityRole} onChange={e=>setAuthorityRole(e.target.value)}><option value="HOD">HOD</option><option value="MEETING_COORDINATOR">Meeting Coordinator</option></select>
      <button disabled={busy||!departmentId||!userId} onClick={()=>void save()} className="rounded-xl bg-brand-700 px-5 py-2.5 font-bold text-white disabled:opacity-50">{busy?<Loader2 className="animate-spin" size={17}/>:"Assign"}</button>
    </div></section>
    <section className="mt-6 overflow-hidden rounded-2xl border bg-white dark:border-slate-800 dark:bg-slate-900"><div className="border-b p-5 dark:border-slate-800"><h2 className="font-black">Active authorities</h2></div>
      {rows.map(row=><div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-0 dark:border-slate-800"><div><b>{row.user?.name??row.userId}</b><p className="text-xs text-slate-500">{row.department?.name??row.departmentId} · {row.authorityRole.replaceAll("_"," ")}</p></div><button disabled={busy} onClick={()=>void revoke(row.id)} className="rounded-lg border p-2 text-red-700" aria-label="Revoke authority"><Trash2 size={16}/></button></div>)}
      {!rows.length&&<p className="p-6 text-sm text-slate-500">No HOD or department meeting authorities assigned.</p>}
    </section>
  </div><style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:transparent}`}</style></main>
}
export default function Page(){return <AuthGate roles={["SUPER_ADMIN","BRANCH_ADMIN"]}><Content/></AuthGate>}
