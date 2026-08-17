"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getAccessToken } from "./auth-provider";
import {
  Award, BarChart3, BookOpen, Building2, CalendarCheck, ClipboardCheck,
  CreditCard, FileText, GraduationCap, LayoutDashboard, Menu, Settings, CalendarDays, NotebookPen, FileCheck2, PlaySquare,
  UserRoundCheck, Users, X, BriefcaseBusiness, Landmark, Bus, Library, Bell, Boxes, BrainCircuit, School,
} from "lucide-react";

const menu = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Organizations", href: "/admin/organizations", icon: School },
  { name: "School Settings", href: "/admin/organization-settings", icon: Settings },
  { name: "Academic Sessions", href: "/admin/academic-sessions", icon: CalendarDays },
  { name: "Students", href: "/admin/students", icon: Users },
  { name: "Teachers", href: "/admin/teachers", icon: UserRoundCheck },
  { name: "Teacher Allocation", href: "/admin/teacher-allocations", icon: ClipboardCheck },
  { name: "Branches", href: "/admin/branches", icon: Building2 },
  { name: "Courses", href: "/admin/courses", icon: BookOpen },
  { name: "Batches", href: "/admin/batches", icon: GraduationCap },
  { name: "Timetable", href: "/admin/timetables", icon: CalendarDays },
  { name: "Homework", href: "/admin/homeworks", icon: NotebookPen },
  { name: "Examinations", href: "/admin/examinations", icon: FileCheck2 },
  { name: "LMS", href: "/admin/lms", icon: PlaySquare },
  { name: "Learning Ecosystem", href: "/admin/learning-ecosystem", icon: BrainCircuit },
  { name: "Attendance", href: "/admin/attendance", icon: CalendarCheck },
  { name: "Tests", href: "/admin/tests", icon: ClipboardCheck },
  { name: "Fees", href: "/admin/fees", icon: CreditCard },
  { name: "Enquiries", href: "/admin/enquiries", icon: FileText },
  { name: "Certificates", href: "/admin/certificates", icon: Award },
  { name: "HR & Payroll", href: "/admin/hr", icon: BriefcaseBusiness },
  { name: "Finance ERP", href: "/admin/finance", icon: Landmark },
  { name: "Transport", href: "/admin/transport", icon: Bus },
  { name: "Library", href: "/admin/library", icon: Library },
  { name: "Hostel", href: "/admin/hostel", icon: Building2 },
  { name: "Communication", href: "/admin/communication", icon: Bell },
  { name: "Inventory & Assets", href: "/admin/inventory", icon: Boxes },
  { name: "AI Analytics", href: "/admin/analytics", icon: BrainCircuit },
  { name: "Reports", href: "/admin/reports", icon: BarChart3 },
  { name: "Settings", href: "/admin/settings", icon: Settings },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <nav className="space-y-1">{menu.map((item) => {
    const Icon = item.icon;
    const active = pathname === item.href;
    return <Link key={item.name} href={item.href} onClick={onNavigate} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-brand-700 text-white shadow-lg shadow-blue-900/15" : "text-slate-600 hover:bg-brand-50 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-slate-900"}`}><Icon size={18}/>{item.name}</Link>;
  })}</nav>;
}

export default function Sidebar() {
  const [open, setOpen] = useState(false); const [sessions,setSessions]=useState<{id:string;name:string;isCurrent:boolean}[]>([]); const api=process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000/api/v1";
  useEffect(()=>{const token=getAccessToken();if(!token)return;fetch(`${api}/admin/academic-sessions?limit=100&status=active`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()).then(j=>setSessions(j.data??[])).catch(()=>{})},[api]);
  const current=sessions.find(x=>x.isCurrent)?.id??"";const choose=async(id:string)=>{const r=await fetch(`${api}/admin/academic-sessions/${id}/current`,{method:"PATCH",headers:{Authorization:`Bearer ${getAccessToken()??""}`}});if(r.ok)setSessions(v=>v.map(x=>({...x,isCurrent:x.id===id}))) };
  return <>
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-white px-3 py-6 dark:border-slate-800 dark:bg-slate-950 md:flex">
      <Link href="/admin" className="px-3 font-bold tracking-tight text-brand-700">BEING <span className="text-brand-orange">BRILLIANT</span><span className="mt-1 block text-[10px] font-semibold tracking-[0.2em] text-slate-400">ADMIN PORTAL</span></Link>
      {sessions.length>0&&<label className="mt-6 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Current session<select aria-label="Current academic session" value={current} onChange={e=>void choose(e.target.value)} className="mt-2 w-full rounded-lg border bg-white p-2 text-sm font-semibold normal-case text-slate-700 dark:bg-slate-900 dark:text-slate-200">{sessions.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
      <div className="mt-4 flex-1 overflow-y-auto"><Navigation /></div>
      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-900">Academy operations<br/><b className="text-slate-800 dark:text-slate-200">Manage with clarity</b></div>
    </aside>
    <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-950 md:hidden"><span className="font-bold text-brand-700">BBA ADMIN</span><button aria-label="Open navigation" onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-700 dark:text-slate-200"><Menu size={21}/></button></div>
    {open && <div className="fixed inset-0 z-50 md:hidden"><button aria-label="Close navigation" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/45"/><aside className="relative flex h-full w-72 flex-col bg-white px-3 py-6 shadow-2xl dark:bg-slate-950"><div className="flex items-center justify-between px-3"><span className="font-bold text-brand-700">BEING BRILLIANT</span><button aria-label="Close navigation" onClick={() => setOpen(false)} className="rounded-lg p-2"><X size={20}/></button></div><div className="mt-8"><Navigation onNavigate={() => setOpen(false)} /></div></aside></div>}
  </>;
}
