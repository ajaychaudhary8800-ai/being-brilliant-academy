"use client";

import Link from "next/link";
import { BarChart3, Boxes, BriefcaseBusiness, Bus, CreditCard, Landmark, Library, School } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import AttendanceReports from "../../../components/attendance-reports";

const reportAreas = [
  { title: "Fees & Collections", description: "Receivables, collections, refunds, reversals and outstanding fee reporting.", href: "/admin/fees", icon: CreditCard },
  { title: "Finance & Statutory Reports", description: "Trial balance, P&L, balance sheet, cash flow, books and outstanding statements.", href: "/admin/finance", icon: Landmark },
  { title: "Analytics & Insights", description: "Performance, growth and operational analytics across enabled modules.", href: "/admin/analytics", icon: BarChart3 },
  { title: "HR & Payroll", description: "Employee, attendance, leave and payroll operational reporting.", href: "/admin/hr", icon: BriefcaseBusiness },
  { title: "Inventory & Assets", description: "Asset valuation, depreciation, stock and maintenance reports.", href: "/admin/inventory", icon: Boxes },
  { title: "Transport", description: "Fleet, occupancy, fuel, maintenance and fee reports.", href: "/admin/transport", icon: Bus },
  { title: "Library", description: "Circulation, fines, popular titles and inventory reports.", href: "/admin/library", icon: Library },
  { title: "Hostel", description: "Occupancy, vacancies, fee and resident reports.", href: "/admin/hostel", icon: School },
] as const;

export default function ReportsPage() {
  return <ProtectedAdminWorkspace title="Reports" description="Generate attendance reports here and open specialized operational, financial and analytics reports from one place.">
    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {reportAreas.map(area => {
        const Icon = area.icon;
        return <Link key={area.title} href={area.href} className="rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:bg-slate-900">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon size={19}/></span>
          <h2 className="mt-3 font-bold">{area.title}</h2>
          <p className="mt-1 text-sm leading-5 text-slate-500">{area.description}</p>
          <span className="mt-3 inline-block text-sm font-semibold text-brand-700">Open reports →</span>
        </Link>;
      })}
    </section>
    <AttendanceReports/>
  </ProtectedAdminWorkspace>;
}
