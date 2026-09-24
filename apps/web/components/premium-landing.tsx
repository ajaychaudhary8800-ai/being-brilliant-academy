"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  FileText,
  GraduationCap,
  Layers,
  LineChart,
  Lock,
  MessageSquare,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  UserCheck,
  Wallet,
} from "lucide-react";
import { SiteHeader } from "./site-header";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

const engines = [
  {
    title: "ERP",
    subtitle: "Operations & administration",
    description: "Students, attendance, fees, finance, HR, payroll, timetables, examinations and daily operations.",
    icon: <Building2 />,
  },
  {
    title: "LMS",
    subtitle: "Teaching & learning",
    description: "Lessons, study material, homework, assessments, submissions, feedback and learner progress.",
    icon: <BookOpen />,
  },
  {
    title: "CRM",
    subtitle: "Admissions & engagement",
    description: "Enquiries, follow-ups, admission pipeline, communication and conversion visibility.",
    icon: <Users />,
  },
  {
    title: "Analytics",
    subtitle: "Management intelligence",
    description: "Operational, academic, financial and branch-level insights in one management view.",
    icon: <BarChart3 />,
  },
];

const modules = [
  { title: "Admissions & CRM", text: "Enquiries, follow-ups, lead pipeline and admission conversion.", icon: <UserCheck /> },
  { title: "Student Information", text: "Profiles, guardians, documents, courses, batches and academic history.", icon: <GraduationCap /> },
  { title: "Attendance", text: "Student and staff attendance with reports and operational visibility.", icon: <CheckCircle2 /> },
  { title: "Fees & Finance", text: "Fee plans, collections, dues, receipts and financial workflows.", icon: <Wallet /> },
  { title: "Learning Management", text: "Lessons, resources, homework, submissions and learning progress.", icon: <BookOpen /> },
  { title: "Examinations", text: "Exam planning, papers, evaluation, marks, results and reports.", icon: <FileText /> },
  { title: "HR & Payroll", text: "Employees, departments, designations, leave, attendance and payroll.", icon: <Users /> },
  { title: "Communication", text: "Announcements, notices, circulars, alerts and role-based messaging.", icon: <MessageSquare /> },
  { title: "Timetable & Operations", text: "Subjects, teachers, classrooms, batches, schedules and substitutions.", icon: <Settings /> },
  { title: "Analytics & Reports", text: "Decision-ready dashboards across academics, finance and operations.", icon: <LineChart /> },
];

const lifecycle = [
  "Enquiry",
  "Follow-up",
  "Admission",
  "Fees",
  "Class / Batch",
  "Attendance",
  "Learning",
  "Homework",
  "Examination",
  "Result",
  "Parent Communication",
];

const roles = [
  "Super Admin",
  "Organisation Admin",
  "Branch Admin",
  "Teacher",
  "Student",
  "Parent",
  "Accountant",
  "Employee / HR",
];

const plans = [
  {
    name: "Essentials",
    description: "Core institutional operations for a growing education organisation.",
    features: ["Student management", "Attendance", "Fees", "Academic operations", "Core reports"],
  },
  {
    name: "Growth",
    description: "Integrated operations, learning and admissions management.",
    features: ["Everything in Essentials", "LMS", "CRM & enquiries", "Communication", "Examinations"],
  },
  {
    name: "Professional",
    description: "For multi-department and multi-branch institutions needing deeper control.",
    features: ["Everything in Growth", "HR & payroll", "Advanced analytics", "Multi-branch operations", "Management reporting"],
  },
  {
    name: "Enterprise",
    description: "For education groups, partners and white-label deployments.",
    features: ["Everything in Professional", "White-label branding", "Custom domain", "Module entitlements", "Enterprise rollout support"],
  },
];

export function PremiumLanding() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function requestDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const form = event.currentTarget;
    const data = new FormData(form);
    const contactName = String(data.get("contactName") ?? "").trim();
    const organisationName = String(data.get("organisationName") ?? "").trim();
    const rawMobile = String(data.get("mobile") ?? "").replace(/\D/g, "");
    const mobile = rawMobile.length === 12 && rawMobile.startsWith("91") ? rawMobile.slice(2) : rawMobile;
    const email = String(data.get("email") ?? "").trim();
    const institutionType = String(data.get("institutionType") ?? "Education Institution");
    const studentCount = String(data.get("studentCount") ?? "Not specified");

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setError("Enter a valid 10-digit Indian mobile number.");
      setBusy(false);
      return;
    }

    try {
      const response = await fetch(API + "/premium/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: (contactName + (organisationName ? " — " + organisationName : "")).slice(0, 100),
          mobile,
          email,
          trialRequested: true,
          source: "WEBSITE",
          utm: {
            intent: "B2B_PRODUCT_DEMO",
            organisationName,
            institutionType,
            studentCount,
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Unable to submit your demo request.");
      setSent(true);
      form.reset();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Unable to submit your demo request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <SiteHeader />
      <main id="main-content">
        <section id="platform" className="commercial-hero scroll-mt-24 overflow-hidden">
          <div className="container-page grid min-h-[720px] items-center gap-14 py-16 lg:grid-cols-[1.05fr_.95fr] lg:py-20">
            <div className="hero-reveal">
              <div className="pill inline-flex items-center gap-2">
                <Sparkles size={14} />
                Education ERP • LMS • CRM • Analytics
              </div>
              <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[.98] tracking-[-.045em] sm:text-6xl lg:text-7xl">
                Run your entire education institution from
                <span className="gradient-text"> one platform.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
                Manage admissions, academics, learning, fees, finance, HR, examinations, communication and management analytics in one secure operating system.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <a href="#contact" className="premium-cta">
                  Book a product demo <ArrowRight size={18} />
                </a>
                <a href="#modules" className="premium-secondary dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                  Explore modules
                </a>
              </div>
              <div className="mt-9 flex flex-wrap gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                {["Multi-tenant SaaS", "Role-based portals", "Multi-branch", "White-label ready"].map((item) => (
                  <span key={item} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/80">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="hero-orbit" aria-hidden="true" />
              <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-2xl shadow-blue-200/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 dark:shadow-none">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[.18em] text-brand-700">Management overview</p>
                    <h2 className="mt-1 text-xl font-black">Institution command centre</h2>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">Sample dashboard</span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <DashboardMetric label="Students" value="2,486" change="Active records" />
                  <DashboardMetric label="Today's attendance" value="92.4%" change="Live academic view" />
                  <DashboardMetric label="Fees collected" value="₹18.6L" change="Current period" />
                  <DashboardMetric label="Open enquiries" value="148" change="CRM pipeline" />
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
                  <div className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <p className="font-bold">Operational health</p>
                      <Activity size={18} className="text-brand-700" />
                    </div>
                    <div className="mt-5 space-y-4">
                      <Progress label="Fee collection" value={82} />
                      <Progress label="Attendance completion" value={94} />
                      <Progress label="Homework engagement" value={76} />
                      <Progress label="Admission follow-up" value={88} />
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-950 p-5 text-white">
                    <p className="text-xs font-bold uppercase tracking-[.16em] text-cyan-300">Connected systems</p>
                    <div className="mt-4 space-y-3">
                      {["ERP operations", "LMS learning", "CRM admissions", "Analytics"].map((item) => (
                        <div key={item} className="flex items-center gap-2 text-sm font-semibold">
                          <CheckCircle2 size={16} className="text-emerald-400" />
                          {item}
                        </div>
                      ))}
                    </div>
                    <div className="mt-6 rounded-xl bg-white/10 p-3 text-xs leading-5 text-slate-300">
                      Illustrative interface. Live metrics depend on each institution&apos;s data and enabled modules.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-100 bg-white py-7 dark:border-slate-800 dark:bg-slate-950">
          <div className="container-page flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm font-bold text-slate-500">
            <span>BUILT FOR</span>
            {["Schools", "Coaching Institutes", "Training Institutes", "Education Groups", "Multi-branch Networks"].map((item) => (
              <span key={item} className="text-slate-800 dark:text-slate-200">{item}</span>
            ))}
          </div>
        </section>

        <section className="container-page scroll-mt-24 py-20 sm:py-24" aria-labelledby="engines-heading">
          <Eyebrow>One connected platform</Eyebrow>
          <div className="mt-3 grid gap-6 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
            <h2 id="engines-heading" className="section-title max-w-2xl">Four engines. One source of truth.</h2>
            <p className="max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
              ERP manages the institution. LMS manages learning. CRM manages growth. Analytics connects the decisions.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {engines.map((engine) => (
              <article key={engine.title} className="card p-6">
                <div className="grid size-11 place-items-center rounded-xl bg-blue-50 text-brand-700 dark:bg-blue-950/50">{engine.icon}</div>
                <h3 className="mt-6 text-2xl font-black">{engine.title}</h3>
                <p className="mt-1 text-sm font-bold text-brand-700">{engine.subtitle}</p>
                <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">{engine.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="modules" className="scroll-mt-24 bg-slate-50 py-20 dark:bg-slate-900/40 sm:py-24">
          <div className="container-page">
            <Eyebrow>Platform modules</Eyebrow>
            <h2 className="section-title mt-3 max-w-3xl">Every major institutional workflow, connected.</h2>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600 dark:text-slate-300">
              Replace fragmented spreadsheets and disconnected applications with role-aware workflows built around the same student, employee and organisation data.
            </p>
            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
              {modules.map((module) => (
                <article key={module.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="grid size-10 place-items-center rounded-xl bg-blue-50 text-brand-700 dark:bg-blue-950/50">{module.icon}</div>
                  <h3 className="mt-5 font-black">{module.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{module.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="container-page py-20 sm:py-24">
          <div className="rounded-[2rem] bg-slate-950 px-6 py-10 text-white sm:px-10">
            <Eyebrow dark>Student lifecycle</Eyebrow>
            <div className="mt-3 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <h2 className="max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">One student. One record. Complete lifecycle visibility.</h2>
              <p className="max-w-xl text-sm leading-6 text-slate-300">Every stage can feed the next without duplicating the same information across separate tools.</p>
            </div>
            <div className="mt-9 flex flex-wrap gap-2">
              {lifecycle.map((step, index) => (
                <div key={step} className="inline-flex items-center gap-2">
                  <span className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold">{step}</span>
                  {index < lifecycle.length - 1 && <ArrowRight size={14} className="text-slate-500" aria-hidden="true" />}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="solutions" className="scroll-mt-24 border-y border-slate-100 bg-blue-50/60 py-20 dark:border-slate-800 dark:bg-blue-950/20 sm:py-24">
          <div className="container-page">
            <Eyebrow>Institution-aware experience</Eyebrow>
            <h2 className="section-title mt-3 max-w-3xl">The same platform should not feel the same for every institution.</h2>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600 dark:text-slate-300">
              Terminology, navigation and operational emphasis can adapt to schools, coaching centres, training institutes and multi-branch education groups.
            </p>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              <Solution title="Schools" items={["Classes & sections", "Academic sessions", "Parent communication", "Examinations & report workflows"]} />
              <Solution title="Coaching Institutes" items={["Batches & courses", "Competitive programmes", "Fee tracking", "Tests & learning progress"]} />
              <Solution title="Training Institutes" items={["Skill programmes", "Learner cohorts", "Content delivery", "Assessment & certification workflows"]} />
              <Solution title="Education Groups" items={["Multiple organisations", "Multiple branches", "Central controls", "Group-level visibility"]} />
            </div>
          </div>
        </section>

        <section className="container-page py-20 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[.85fr_1.15fr] lg:items-center">
            <div>
              <Eyebrow>Role-based workspaces</Eyebrow>
              <h2 className="section-title mt-3">The right workspace for every user.</h2>
              <p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-300">
                Users see the tools, records and actions appropriate to their role instead of navigating one overloaded interface.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-3">
                {roles.map((role) => (
                  <div key={role} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold dark:border-slate-800">
                    <Users size={17} className="text-brand-700" />
                    {role}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[.18em] text-brand-700">Workspace model</p>
                  <h3 className="mt-1 text-2xl font-black">Organisation → Branch → Role → Workflow</h3>
                </div>
                <Layers className="text-brand-700" />
              </div>
              <div className="mt-6 space-y-3">
                {[
                  ["Organisation controls", "Plans, modules, branding and tenant settings"],
                  ["Branch operations", "Students, employees, fees and local workflows"],
                  ["Role permissions", "Access scoped to responsibilities and records"],
                  ["Auditability", "Operational changes stay attributable and reviewable"],
                ].map(([title, text]) => (
                  <div key={title} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-950">
                    <p className="font-bold">{title}</p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="analytics" className="scroll-mt-24 bg-slate-950 py-20 text-white sm:py-24">
          <div className="container-page">
            <Eyebrow dark>Management analytics</Eyebrow>
            <div className="mt-3 grid gap-6 lg:grid-cols-2 lg:items-end">
              <h2 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">See what is happening across the institution.</h2>
              <p className="max-w-2xl text-lg leading-8 text-slate-300">
                Bring operational and academic signals into management dashboards instead of waiting for manually consolidated reports.
              </p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {["Fee collection & dues", "Admission conversion", "Student attendance", "Academic performance", "Teacher attendance", "Branch comparison", "Employee cost", "Revenue trends"].map((item) => (
                <div key={item} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                  <BarChart3 className="text-cyan-300" size={20} />
                  <p className="mt-5 font-bold">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="white-label" className="container-page scroll-mt-24 py-20 sm:py-24">
          <div className="grid gap-10 rounded-[2.2rem] border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-7 dark:border-slate-800 dark:from-blue-950/30 dark:via-slate-950 dark:to-cyan-950/20 sm:p-10 lg:grid-cols-[1fr_.9fr]">
            <div>
              <Eyebrow>Multi-tenant & white-label</Eyebrow>
              <h2 className="section-title mt-3">Your institution. Your identity. One technology foundation.</h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
                Support independent organisations and branches while preserving tenant-level configuration, branding and access boundaries.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {["Organisation-specific branding", "Custom domain support", "Module entitlements", "Subscription plans", "Multi-branch hierarchy", "Role-based access", "Tenant-specific settings", "Branded login experience"].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-xl border border-white bg-white/80 p-4 font-semibold shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
                  <span className="text-sm">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="security" className="scroll-mt-24 border-y border-slate-100 bg-slate-50 py-20 dark:border-slate-800 dark:bg-slate-900/40 sm:py-24">
          <div className="container-page grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <Eyebrow>Operational trust</Eyebrow>
              <h2 className="section-title mt-3">Designed for controlled institutional access.</h2>
              <p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-300">
                Security and reliability are treated as platform concerns, not optional add-ons.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TrustCard icon={<ShieldCheck />} title="Tenant data isolation" text="Organisation-scoped data access and tenant-aware workflows." />
              <TrustCard icon={<Lock />} title="Role-based access control" text="Users receive permissions aligned to their responsibilities." />
              <TrustCard icon={<FileText />} title="Audit-oriented workflows" text="Sensitive operational changes can remain attributable and reviewable." />
              <TrustCard icon={<Activity />} title="Backup & operational readiness" text="Platform operations support recoverability and production monitoring practices." />
            </div>
          </div>
        </section>

        <section id="pricing" className="container-page scroll-mt-24 py-20 sm:py-24">
          <Eyebrow>Commercial plans</Eyebrow>
          <div className="mt-3 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <h2 className="section-title max-w-3xl">Choose a package around the institution you operate.</h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
                Final commercial pricing can scale by students, branches, enabled modules and white-label requirements.
              </p>
            </div>
            <a href="#contact" className="font-bold text-brand-700">Discuss pricing →</a>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan, index) => (
              <article key={plan.name} className={"rounded-2xl border p-6 " + (index === 1 ? "border-brand-700 bg-blue-50/60 dark:bg-blue-950/20" : "border-slate-200 dark:border-slate-800")}>
                <p className="text-sm font-black uppercase tracking-[.15em] text-brand-700">{plan.name}</p>
                <p className="mt-4 min-h-16 text-sm leading-6 text-slate-600 dark:text-slate-300">{plan.description}</p>
                <div className="mt-6 space-y-3">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex gap-2 text-sm">
                      <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
                <a href="#contact" className="mt-7 inline-flex items-center gap-2 font-bold text-brand-700">
                  Contact sales <ArrowRight size={16} />
                </a>
              </article>
            ))}
          </div>
        </section>

        <section id="contact" className="scroll-mt-24 bg-brand-700 py-20 text-white sm:py-24">
          <div className="container-page grid gap-12 lg:grid-cols-[.85fr_1.15fr] lg:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[.2em] text-cyan-200">Product demo</p>
              <h2 className="mt-3 text-4xl font-black leading-tight tracking-tight sm:text-5xl">See how the platform fits your institution.</h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-blue-100">
                Tell us what you operate and we can structure the demo around admissions, academics, finance, LMS, CRM, HR, analytics or white-label requirements.
              </p>
              <div className="mt-8 space-y-3 text-sm font-semibold text-blue-50">
                {["Institution-specific walkthrough", "Module and workflow discussion", "Multi-branch / white-label assessment", "Commercial packaging discussion"].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 size={18} className="text-cyan-200" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] bg-white p-6 text-slate-900 shadow-2xl sm:p-8">
              {sent ? (
                <div className="py-10 text-center">
                  <CheckCircle2 className="mx-auto text-emerald-600" size={52} />
                  <h3 className="mt-5 text-2xl font-black">Demo request received.</h3>
                  <p className="mx-auto mt-2 max-w-md text-slate-600">Your details have been recorded. The product team can follow up for the next step.</p>
                  <button onClick={() => setSent(false)} className="mt-6 font-bold text-brand-700">Submit another request</button>
                </div>
              ) : (
                <>
                  <h3 className="text-2xl font-black">Book a product demo</h3>
                  <p className="mt-2 text-sm text-slate-500">For schools, coaching institutes, training institutes and education groups.</p>
                  <form onSubmit={requestDemo} className="mt-6 grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>
                        Contact name
                        <input required name="contactName" minLength={2} className="form-input" />
                      </label>
                      <label>
                        Organisation name
                        <input required name="organisationName" minLength={2} className="form-input" />
                      </label>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>
                        Mobile number
                        <input required name="mobile" inputMode="numeric" autoComplete="tel" className="form-input" />
                      </label>
                      <label>
                        Work email
                        <input required name="email" type="email" autoComplete="email" className="form-input" />
                      </label>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>
                        Institution type
                        <select name="institutionType" className="form-input">
                          <option>School</option>
                          <option>Coaching Institute</option>
                          <option>Training Institute</option>
                          <option>Education Group</option>
                          <option>Other</option>
                        </select>
                      </label>
                      <label>
                        Approx. students
                        <select name="studentCount" className="form-input">
                          <option>Under 500</option>
                          <option>500–2,000</option>
                          <option>2,000–5,000</option>
                          <option>5,000+</option>
                        </select>
                      </label>
                    </div>
                    {error && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}
                    <button disabled={busy} className="premium-cta justify-center disabled:opacity-60">
                      {busy ? "Submitting…" : "Request demo"}
                    </button>
                    <p className="text-xs leading-5 text-slate-500">By submitting, you are asking our team to contact you about the education platform.</p>
                  </form>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-slate-950 py-10 text-slate-300">
        <div className="container-page flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <p className="font-black text-white">BEING <span className="text-orange-500">BRILLIANT</span></p>
            <p className="mt-1 text-sm">Education ERP • LMS • CRM • Analytics</p>
          </div>
          <div className="flex flex-wrap gap-5 text-sm font-semibold">
            <a href="#platform" className="hover:text-white">Platform</a>
            <a href="#modules" className="hover:text-white">Modules</a>
            <a href="#solutions" className="hover:text-white">Solutions</a>
            <Link href="/login" className="hover:text-white">Sign in</Link>
          </div>
          <p className="text-xs text-slate-500">© {new Date().getFullYear()} Being Brilliant. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function DashboardMetric({ label, value, change }: { label: string; value: string; change: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{change}</p>
    </div>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-gradient-to-r from-brand-700 to-cyan-400" style={{ width: value + "%" }} />
      </div>
    </div>
  );
}

function Solution({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="rounded-2xl border border-blue-100 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <Building2 className="text-brand-700" />
      <h3 className="mt-5 text-xl font-black">{title}</h3>
      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <div key={item} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
            {item}
          </div>
        ))}
      </div>
    </article>
  );
}

function TrustCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="grid size-11 place-items-center rounded-xl bg-blue-50 text-brand-700 dark:bg-blue-950/50">{icon}</div>
      <h3 className="mt-5 font-black">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{text}</p>
    </article>
  );
}

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={"text-xs font-black uppercase tracking-[.2em] " + (dark ? "text-cyan-300" : "text-brand-700")}>{children}</p>;
}
