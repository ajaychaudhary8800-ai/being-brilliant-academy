"use client";

import { CheckCircle2, Download, ExternalLink, FileSpreadsheet, Printer, ShieldCheck } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { useAuth } from "../../../components/auth-provider";

const templates = [
  { name: "Client information & requirements", file: "/client-kit/client-information.csv", mode: "Collection form", note: "Use before tenant provisioning." },
  { name: "Branch / campus setup", file: "/client-kit/branches-data-collection.csv", mode: "Collection / mapping", note: "Matches branch-creation fields; review manager details before creating the branch." },
  { name: "Students", file: "/client-kit/students-import.csv", mode: "Direct import", note: "CSV/XLSX/JSON supported in Student Management after IDs are mapped." },
  { name: "Teachers", file: "/client-kit/teachers-data-collection.csv", mode: "Collection / mapping", note: "Map branch, subjects and specializations before creating records." },
  { name: "Employees / HR", file: "/client-kit/employees-import.csv", mode: "Direct import", note: "CSV/XLSX/JSON supported in HR & Payroll; tenant master IDs are required." },
  { name: "Courses / Programs", file: "/client-kit/courses-data-collection.csv", mode: "Collection / mapping", note: "Use to map the client's academic catalogue to platform taxonomy." },
  { name: "Fee structure", file: "/client-kit/fees-data-collection.csv", mode: "Collection / mapping", note: "Use to build fee plans/installments after academic masters exist." },
  { name: "Finance accounts", file: "/client-kit/finance-accounts-import.csv", mode: "Direct import", note: "CSV/XLSX/JSON supported in Finance; branch/group IDs and paise amounts are required." },
] as const;

const implementation = [
  "Confirm signed scope, SaaS plan, limits and billing status.",
  "Collect the expanded client information sheet, branch/campus sheet and authorized administrator details.",
  "Provision the tenant and confirm secure administrator account activation.",
  "Create branch/campus and academic master data.",
  "Map source data to tenant-specific IDs and masters.",
  "Import/enter data and reconcile row counts and failures.",
  "Configure only modules included in the assigned plan.",
  "Complete administrator/user training.",
  "Run client UAT for every applicable critical workflow.",
  "Configure custom domain/DNS/TLS when included in the plan.",
  "Verify production backup, monitoring and recovery commitments.",
  "Record client sign-off, mark onboarding 100% READY and run production smoke testing.",
];

const uat = [
  "Login, password setup and role access",
  "Branch/campus and organization settings",
  "Student records/import and teacher/staff records",
  "Courses, batches/sections, subjects and timetable",
  "Attendance",
  "Homework assignment, submission and feedback",
  "Examination, answer submission, evaluation and results",
  "Fees, receipts, defaulters and adjustments",
  "Finance/accounting when licensed",
  "LMS learning content and learner access",
  "Student, parent, teacher and employee portals as applicable",
  "Communication/notices/announcements",
  "HR/payroll when licensed",
  "Reports/analytics when licensed",
  "Branding, plan entitlements and custom domain when applicable",
];

export default function Page() {
  const { user } = useAuth();
  const platform = user?.role === "SUPER_ADMIN" && user.organizationId === "org_default";

  return <ProtectedAdminWorkspace
    roles={["SUPER_ADMIN"]}
    title="Client Implementation Kit"
    description="Operational resources for requirements collection, data migration, UAT, handover and production go-live."
  >
    {!platform ? <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      This workspace is available only to the platform Super Admin.
    </div> : <div className="mt-6 space-y-6">
      <section className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">Client data templates</h2>
            <p className="mt-1 text-sm text-slate-500">Direct-import files match current import contracts. Collection/mapping files must be reviewed before data entry or migration.</p>
          </div>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold">
            <Printer size={16}/>Print implementation checklist
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {templates.map(template => <article key={template.file} className="rounded-xl border p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><FileSpreadsheet size={18}/></span>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold">{template.name}</h3>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{template.mode}</p>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{template.note}</p>
                <a href={template.file} download className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-700"><Download size={15}/>Download CSV template</a>
              </div>
            </div>
          </article>)}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-xl font-bold">Implementation sequence</h2>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {implementation.map((item, index) => <div key={item} className="flex gap-3 rounded-lg border p-3 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{index + 1}</span>
            <span>{item}</span>
          </div>)}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-xl font-bold">UAT & go-live acceptance</h2>
        <p className="mt-1 text-sm text-slate-500">Record PASS, FAIL or NOT APPLICABLE for every item included in the client&apos;s plan. Critical failures must be fixed or explicitly accepted as deferred before go-live approval.</p>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {uat.map(item => <div key={item} className="flex items-start gap-2 rounded-lg border p-3 text-sm"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-slate-400"/><span>{item}</span></div>)}
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-900">
          <p className="font-bold">Sign-off record</p>
          <p className="mt-2">Record organization, production URL, plan, go-live date, migration status, training completion, UAT owner, accepted outstanding items, client approver/name/designation/date, and platform approver/name/designation/date.</p>
          <p className="mt-2 font-semibold">Do not mark Go-live approved in Organization Onboarding until an authorized client representative has accepted the production setup.</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="card p-5">
          <h2 className="flex items-center gap-2 text-xl font-bold"><ExternalLink size={19}/>Custom domain handover</h2>
          <ol className="mt-4 space-y-2 text-sm">
            <li>1. Confirm the plan includes custom-domain entitlement.</li>
            <li>2. Obtain the desired hostname from the client.</li>
            <li>3. Client grants controlled DNS access or adds records supplied by platform operations.</li>
            <li>4. Save the tenant domain and configure it in Coolify/proxy.</li>
            <li>5. Verify DNS and TLS.</li>
            <li>6. Test login, password-reset links, API routing and tenant isolation.</li>
            <li>7. Keep shared workspace login available as fallback.</li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">Do not provide a universal A/CNAME target; use the active production infrastructure target.</p>
        </article>

        <article className="card p-5">
          <h2 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck size={19}/>Support, security & recovery</h2>
          <div className="mt-4 space-y-3 text-sm">
            <p><b>P1 Critical:</b> production outage, cross-tenant exposure, severe security incident, or widespread core-workflow failure.</p>
            <p><b>P2 High:</b> major licensed module unavailable without a practical workaround.</p>
            <p><b>P3 Normal:</b> isolated defect, configuration/data correction, usability issue, or how-to request.</p>
            <p>Contractual response/resolution times must come from the signed commercial agreement; do not invent SLA promises.</p>
            <p>Before paid production launch, verify recent backup, checksums, retention, disk capacity and monitoring. Do not promise off-site disaster recovery unless off-site storage and an appropriate restore drill have been verified.</p>
          </div>
        </article>
      </section>

      <section className="card p-5">
        <h2 className="text-xl font-bold">Final handover gate</h2>
        <p className="mt-2 text-sm">A client is ready only when Organization Onboarding reports <b>100% · READY</b>, applicable UAT has passed, entitlements and billing are aligned, client administrator access is confirmed, required data is reconciled, training is complete/not required, the production URL is verified, go-live approval is recorded, and the production smoke test passes.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href="/admin/organizations" className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white">Open Organizations</a>
          <a href="/admin/saas-billing" className="rounded-lg border px-4 py-2.5 text-sm font-semibold">Open SaaS Billing</a>
        </div>
      </section>
    </div>}
  </ProtectedAdminWorkspace>;
}
