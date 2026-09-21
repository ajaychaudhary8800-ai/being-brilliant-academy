"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getAccessToken, useAuth } from "./auth-provider";
import { useGroupTerminology } from "./use-group-terminology";
import { useTenantBranding } from "./tenant-branding";
import {
  Award, BarChart3, BookOpen, Building2, CalendarCheck, CalendarClock, ClipboardCheck,
  CreditCard, FileText, GraduationCap, LayoutDashboard, Menu, Settings, CalendarDays, NotebookPen, FileCheck2, PlaySquare,
  UserRoundCheck, Users, X, BriefcaseBusiness, Landmark, Bus, Library, Bell, Boxes, BrainCircuit, School,
} from "lucide-react";

type DynamicLabel = "courses" | "groups" | "educators" | "assessments" | "learning";
type CommercialFeature = "crm" | "lms" | "hr_payroll" | "finance" | "communication" | "transport" | "library" | "hostel" | "inventory" | "analytics";
type MenuEntry = { name: string; href: string; icon: typeof LayoutDashboard; dynamicLabel?: DynamicLabel; superAdminOnly?: boolean; platformOnly?: boolean; tenantOnly?: boolean; feature?: CommercialFeature };
type MenuGroup = { name: string; entries: MenuEntry[] };

const menuGroups: MenuGroup[] = [
  { name: "Overview", entries: [{ name: "Dashboard", href: "/admin", icon: LayoutDashboard }] },
  { name: "Institution", entries: [
    { name: "Organizations", href: "/admin/organizations", icon: School, platformOnly: true },
    { name: "SaaS Plans", href: "/admin/saas-plans", icon: CreditCard, platformOnly: true },
    { name: "SaaS Billing", href: "/admin/saas-billing", icon: CreditCard, platformOnly: true },
    { name: "Institution Settings", href: "/admin/organization-settings", icon: Settings },
    { name: "Branches", href: "/admin/branches", icon: Building2 },
    { name: "Academic Sessions", href: "/admin/academic-sessions", icon: CalendarDays },
    { name: "Classrooms", href: "/admin/classrooms", icon: Building2 },
  ] },
  { name: "People", entries: [
    { name: "Students", href: "/admin/students", icon: Users },
    { name: "Teachers", href: "/admin/teachers", icon: UserRoundCheck, dynamicLabel: "educators" },
    { name: "User Management", href: "/admin/users", icon: Users },
    { name: "Accountants", href: "/admin/accountants", icon: Landmark, superAdminOnly: true },
    { name: "HR & Payroll", href: "/admin/hr", icon: BriefcaseBusiness, feature: "hr_payroll" },
    { name: "Birthdays", href: "/admin/birthdays", icon: Bell },
  ] },
  { name: "Academics", entries: [
    { name: "Courses", href: "/admin/courses", icon: BookOpen, dynamicLabel: "courses" },
    { name: "Batches", href: "/admin/batches", icon: GraduationCap, dynamicLabel: "groups" },
    { name: "Subjects", href: "/admin/subjects", icon: BookOpen },
    { name: "Teacher Allocation", href: "/admin/teacher-allocations", icon: ClipboardCheck },
    { name: "Timetable", href: "/admin/timetables", icon: CalendarDays },
    { name: "Academic Operations", href: "/admin/academic-operations", icon: CalendarClock },
    { name: "Homework", href: "/admin/homeworks", icon: NotebookPen },
    { name: "Examinations", href: "/admin/examinations", icon: FileCheck2, dynamicLabel: "assessments" },
    { name: "Answer Submissions", href: "/admin/examination-submissions", icon: FileCheck2 },
    { name: "Tests", href: "/admin/tests", icon: ClipboardCheck },
    { name: "LMS", href: "/admin/lms", icon: PlaySquare, feature: "lms" },
    { name: "Learning Resources", href: "/admin/learning-ecosystem", icon: BrainCircuit, dynamicLabel: "learning", feature: "lms" },
  ] },
  { name: "Admissions", entries: [
    { name: "Admissions CRM", href: "/admin/enquiries", icon: FileText, feature: "crm" },
    { name: "Certificates", href: "/admin/certificates", icon: Award },
  ] },
  { name: "Attendance & Leave", entries: [
    { name: "Attendance", href: "/admin/attendance", icon: CalendarCheck },
    { name: "Leave Management", href: "/admin/leaves", icon: CalendarCheck },
  ] },
  { name: "Fees & Finance", entries: [
    { name: "Fees", href: "/admin/fees", icon: CreditCard },
    { name: "Outstanding Fees", href: "/admin/fee-defaulters", icon: Bell },
    { name: "Finance & Accounts", href: "/admin/finance", icon: Landmark, feature: "finance" },
  ] },
  { name: "Communication", entries: [
    { name: "Communication", href: "/admin/communication", icon: Bell, feature: "communication" },
    { name: "Notice Board", href: "/admin/notices", icon: Bell, feature: "communication" },
  ] },
  { name: "Operations", entries: [
    { name: "Transport", href: "/admin/transport", icon: Bus, feature: "transport" },
    { name: "Library", href: "/admin/library", icon: Library, feature: "library" },
    { name: "Hostel", href: "/admin/hostel", icon: Building2, feature: "hostel" },
    { name: "Inventory & Assets", href: "/admin/inventory", icon: Boxes, feature: "inventory" },
  ] },
  { name: "Reports & Analytics", entries: [
    { name: "Analytics & Insights", href: "/admin/analytics", icon: BrainCircuit, feature: "analytics" },
    { name: "Reports", href: "/admin/reports", icon: BarChart3 },
  ] },
  { name: "System", entries: [
    { name: "Subscription & Billing", href: "/admin/subscription", icon: CreditCard, tenantOnly: true, superAdminOnly: true },
    { name: "Settings", href: "/admin/settings", icon: Settings },
  ] },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { brand } = useTenantBranding();
  const terms = useGroupTerminology();
  const [commercialEntitlements, setCommercialEntitlements] = useState<{ enforcementEnabled: boolean; entitlements: Record<string, boolean> } | null>(null);
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  useEffect(() => {
    const token = getAccessToken();
    if (!token || !user?.organizationId) return;
    let active = true;
    fetch(`${api}/organization/entitlements`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : null)
      .then(json => { if (active && json?.data) setCommercialEntitlements(json.data); })
      .catch(() => {});
    return () => { active = false; };
  }, [api, user?.organizationId]);
  const accountantRoutes = new Set(["/admin/finance", "/admin/fees", "/admin/fee-defaulters"]);
  const dynamicLabels: Record<DynamicLabel, string> = { courses: terms.courses, groups: terms.plural, educators: terms.educators, assessments: terms.assessments, learning: terms.learning };
  const groupLabels: Record<string, string> = terms.mode === "SCHOOL"
    ? { Institution: "School Setup", Academics: "Academics & Assessment", Admissions: "Admissions", "Fees & Finance": "School Fees & Finance", "Reports & Analytics": "Reports & Analytics" }
    : terms.mode === "COACHING"
      ? { Institution: "Institute Setup", Academics: "Courses & Learning", Admissions: "Leads & Admissions", "Fees & Finance": "Course Fees & Finance", "Reports & Analytics": "Reports & Performance" }
      : {};
  const groups = menuGroups.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => {
      if (user?.billingRecovery) return entry.href === "/admin/subscription";
      if (entry.feature && commercialEntitlements?.enforcementEnabled && commercialEntitlements.entitlements["*"] !== true && commercialEntitlements.entitlements[entry.feature] !== true) return false;
      if (user?.role === "ACCOUNTANT") return accountantRoutes.has(entry.href);
      if (entry.platformOnly) return user?.role === "SUPER_ADMIN" && user.organizationId === "org_default";
      if (entry.tenantOnly) return user?.role === "SUPER_ADMIN" && user.organizationId !== "org_default";
      if (entry.superAdminOnly) return user?.role === "SUPER_ADMIN";
      return true;
    }),
  })).filter((group) => group.entries.length > 0);

  return <nav aria-label="Administration navigation" className="space-y-5">
    {groups.map((group) => {
      const label = groupLabels[group.name] ?? group.name;
      const headingId = `nav-${group.name.replaceAll(" ", "-").toLowerCase()}`;
      return <section key={group.name} aria-labelledby={headingId}>
        <h2 id={headingId} className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</h2>
        <div className="space-y-1">{group.entries.map((entry) => {
          const Icon = entry.icon;
          const name = entry.href === "/admin/fees" ? terms.mode === "SCHOOL" ? "School Fees" : terms.mode === "COACHING" ? "Course Fees" : entry.name : entry.dynamicLabel ? dynamicLabels[entry.dynamicLabel] : entry.name;
          const active = pathname === entry.href || (entry.href !== "/admin" && pathname.startsWith(`${entry.href}/`));
          return <Link key={entry.href} href={entry.href} onClick={onNavigate} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-brand-700 text-white shadow-lg shadow-blue-900/15" : "text-slate-600 hover:bg-brand-50 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-slate-900"}`}><Icon aria-hidden="true" size={18}/>{name}</Link>;
        })}</div>
      </section>;
    })}
  </nav>;
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; name: string; isCurrent: boolean }[]>([]);
  const { user } = useAuth();
  const { brand } = useTenantBranding();
  const terms = useGroupTerminology();
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  useEffect(() => {
    if (user?.role === "ACCOUNTANT" || user?.billingRecovery) return;
    const token = getAccessToken();
    if (!token) return;
    fetch(`${api}/admin/academic-sessions?limit=100&status=active`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json()).then((json) => setSessions(json.data ?? [])).catch(() => {});
  }, [api, user?.role, user?.billingRecovery]);
  const current = sessions.find((session) => session.isCurrent)?.id ?? "";
  const choose = async (id: string) => {
    const response = await fetch(`${api}/admin/academic-sessions/${id}/current`, { method: "PATCH", headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } });
    if (response.ok) setSessions((value) => value.map((session) => ({ ...session, isCurrent: session.id === id })));
  };
  return <>
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-white px-3 py-6 dark:border-slate-800 dark:bg-slate-950 md:flex">
      <Link href={user?.billingRecovery ? "/admin/subscription" : "/admin"} className="flex items-center gap-3 px-3 font-bold tracking-tight text-brand-700">{brand.logoUrl ? <Image unoptimized src={brand.logoUrl} alt="" width={38} height={38} className="h-10 w-10 rounded-lg bg-white object-contain" /> : <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-700 text-white"><School size={20}/></span>}<span className="min-w-0"><span className="block truncate">{brand.appName}</span><span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">{brand.portalName}</span></span></Link>
      {sessions.length > 0 && <label className="mt-6 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Current session<select aria-label="Current academic session" value={current} onChange={(event) => void choose(event.target.value)} className="mt-2 w-full rounded-lg border bg-white p-2 text-sm font-semibold normal-case text-slate-700 dark:bg-slate-900 dark:text-slate-200">{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></label>}
      <div className="mt-4 flex-1 overflow-y-auto"><Navigation /></div>
      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-900">{terms.institution} operations<br/><b className="text-slate-800 dark:text-slate-200">Manage with clarity</b>{!brand.hideVendorBranding && brand.organizationId && brand.organizationId !== "org_default" ? <span className="mt-2 block text-[10px] uppercase tracking-wider text-slate-400">Powered by Being Brilliant</span> : null}</div>
    </aside>
    <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-950 md:hidden"><span className="max-w-[75%] truncate font-bold text-brand-700">{brand.appName}</span><button type="button" aria-label="Open navigation" onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-700 dark:text-slate-200"><Menu size={21}/></button></div>
    {open && <div className="fixed inset-0 z-50 md:hidden"><button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-950/45"/><aside className="relative flex h-full w-72 flex-col bg-white px-3 py-6 shadow-2xl dark:bg-slate-950"><div className="flex items-center justify-between px-3"><span className="max-w-[190px] truncate font-bold text-brand-700">{brand.appName}</span><button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="rounded-lg p-2"><X size={20}/></button></div><div className="mt-8 flex-1 overflow-y-auto"><Navigation onNavigate={() => setOpen(false)} /></div></aside></div>}
  </>;
}
