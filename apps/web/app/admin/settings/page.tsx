"use client";

import Link from "next/link";
import { Bell, Building2, CreditCard, LockKeyhole, Settings2, ShieldCheck, Users } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { useAuth } from "../../../components/auth-provider";

const sections = [
  { title: "Institution Profile", description: "Branding, locale, timezone, academic terminology and institution preferences.", href: "/admin/organization-settings", icon: Building2 },
  { title: "Branches & Academic Setup", description: "Manage branches, academic sessions and classrooms used throughout the ERP.", href: "/admin/branches", icon: Settings2 },
  { title: "Users, Roles & Access", description: "Create users, review roles and control administrator access.", href: "/admin/users", icon: Users },
  { title: "Communication & Notifications", description: "Manage operational communications, notices and delivery workflows.", href: "/admin/communication", icon: Bell },
  { title: "Subscription & Entitlements", description: "Review the active plan and the modules enabled for this organization.", href: "/admin/subscription", icon: CreditCard, tenantOnly: true },
  { title: "Security & Account Access", description: "Review access controls, password recovery and protected administrator workflows.", href: "/admin/users", icon: LockKeyhole },
] as const;

export default function SettingsPage() {
  const { user } = useAuth();
  const platform = user?.role === "SUPER_ADMIN" && user.organizationId === "org_default";
  const tenant = user?.organizationId && user.organizationId !== "org_default";

  return <ProtectedAdminWorkspace title="Settings" description="Central access to institution configuration, permissions, notifications, security and commercial settings.">
    <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sections.filter(section => !("tenantOnly" in section) || !section.tenantOnly || tenant).map(section => {
        const Icon = section.icon;
        return <Link key={section.title} href={section.href} className="group rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon size={20}/></span>
            <span className="text-sm font-semibold text-brand-700 opacity-0 transition group-hover:opacity-100">Open →</span>
          </div>
          <h2 className="mt-4 text-lg font-bold">{section.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{section.description}</p>
        </Link>;
      })}
      {platform && <Link href="/admin/control-center" className="group rounded-2xl border border-brand-200 bg-brand-50/40 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-700 text-white"><ShieldCheck size={20}/></span>
        <h2 className="mt-4 text-lg font-bold">Platform SaaS Controls</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Open roadmap, platform health, launch readiness, SaaS plans and infrastructure control links.</p>
      </Link>}
    </section>

    <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900">
      <h2 className="font-bold">Configuration principle</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">Operational records stay inside their dedicated modules. This settings workspace now acts as the central navigation point instead of showing an empty placeholder.</p>
    </section>
  </ProtectedAdminWorkspace>;
}
