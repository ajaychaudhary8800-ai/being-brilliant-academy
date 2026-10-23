import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, Building2, CalendarDays, ChartNoAxesCombined, ClipboardCheck, CreditCard, Layers3, LockKeyhole, ShieldCheck, UsersRound } from "lucide-react";
import { SiteHeader } from "../../components/site-header";
import { SchoolOSInterestForm } from "../../components/schoolos-interest-form";
import { publicLegalPagesPublished } from "../../lib/public-legal";

export const metadata: Metadata = {
  title: "Adhyay SchoolOS | ERP, LMS & Admissions for Education Institutions",
  description: "Explore Adhyay SchoolOS for schools and coaching institutes. Request a private demonstration and discuss your workflows, branches and modules.",
  alternates: { canonical: "/schoolos" },
  // A private-preview product page is not a statement that paid GA is live.
  // Change indexing only in a separately authorized commercial launch PR.
  robots: { index: false, follow: false },
};

const capabilities = [
  { icon: Building2, title: "School & coaching operations", description: "Admissions, branch setup, student records, attendance, timetables and institutional workflows." },
  { icon: BookOpenCheck, title: "Learning & examinations", description: "Learning content, homework, examinations, results and teaching-team workflows." },
  { icon: UsersRound, title: "Admissions & engagement", description: "Enquiry follow-up, communication and role-based access for educators and families." },
  { icon: ChartNoAxesCombined, title: "Management visibility", description: "Operational reports and planning views, subject to the modules and capacity contracted." },
];

const workflows = [
  { title: "Independent schools", details: "Class- and section-based academic workflows, authorized attendance, parent access and fee operations." },
  { title: "Coaching institutes", details: "Batches across grade levels, teacher deployment across coaching branches and test preparation workflows." },
  { title: "Education groups", details: "Multi-branch operating controls, role permissions and consolidated institution management." },
];

const rollout = [
  { number: "01", title: "Workflow audit", detail: "Understand institution type, student volume, branches, existing software and pain points." },
  { number: "02", title: "Private demonstration", detail: "Review relevant workflows using a test environment and synthetic demonstration data." },
  { number: "03", title: "Scoped proposal", detail: "Confirm module/capacity needs, pricing, implementation scope and any unsupported dependencies." },
  { number: "04", title: "Verified onboarding", detail: "Contract, provider-verified payment, controlled deployment and institution acceptance when commercially authorized." },
];

export default function SchoolOSPage() {
  const legalPublished = publicLegalPagesPublished();
  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-white">
      <SiteHeader />
      <main id="main-content">
        <section className="relative overflow-hidden bg-slate-950 text-white">
          <div aria-hidden="true" className="pointer-events-none absolute -right-48 -top-72 h-[760px] w-[760px] rounded-full bg-cyan-600/20 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-[22%] h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
          <div className="container-page relative grid min-h-[620px] items-center gap-12 py-20 lg:grid-cols-[1.1fr_.9fr] lg:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs font-bold uppercase tracking-[.17em] text-cyan-200">
                <Layers3 size={15} /> Adhyay SchoolOS · Private demonstrations
              </p>
              <h1 className="mt-7 max-w-3xl text-5xl font-black leading-[1.03] tracking-tight sm:text-6xl">
                One connected operating system for <span className="text-cyan-300">education institutions.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
                Bring academics, admissions, fee workflows, learning, communication and management visibility together. School and coaching formats can be configured differently to match how your institution operates.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <a href="#request-demo" className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-6 py-3.5 font-bold text-slate-950 transition hover:bg-cyan-200">
                  Request a private demo <ArrowRight size={18} />
                </a>
                <a href="#capabilities" className="inline-flex items-center items-center rounded-xl border border-white/20 px-6 py-3.5 font-bold text-white hover:bg-white/10">
                  Explore the platform
                </a>
              </div>
              <p className="mt-5 max-w-xl text-sm leading-6 text-slate-400">
                Commercial preview only. A demonstration request is not a subscription or a payment. Live provider-backed features and paid access are subject to separate validation and approval.
              </p>
            </div>
            <div className="rounded-[2rem] border border-white/10 bg-white/[.07] p-5 shadow-2xl backdrop-blur sm:p-7">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-5">
                <span className="text-lg font-black">SchoolOS workspace</span>
                <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-bold text-cyan-200">Illustrative workflow</span>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-4">
                {[
                  { icon: CalendarDays, label: "Academic operations", detail: "Attendance · Timetable" },
                  { icon: CreditCard, label: "Finance workflows", detail: "Fees · Receipts" },
                  { icon: BookOpenCheck, label: "Learning", detail: "Homework · Results" },
                  { icon: ClipboardCheck, label: "Admissions", detail: "Enquiries · Follow-up" },
                ].map(item => <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[.06] p-5">
                  <item.icon className="text-cyan-200" size={24} />
                  <p className="mt-5 font-bold">{item.label}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-300">{item.detail}</p>
                </div>)}
              </div>
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 p-4 text-sm text-slate-300">
                <ShieldCheck className="shrink-0 text-cyan-200" size={20} />
                Role permissions and contracted entitlements determine what each institution can use.
              </div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="container-page scroll-mt-28 py-20 sm:py-24">
          <p className="text-xs font-black uppercase tracking-[.2em] text-brand-700 dark:text-cyan-300">Core platform</p>
          <h2 className="mt-3 max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-5xl">Connect the work behind better educational operations.</h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 dark:text-slate-300">Modules vary by institution type and contracted plan. We validate individual requirements before issuing a commercial proposal.</p>
          <div className="mt-11 grid gap-5 md:grid-cols-2">
            {capabilities.map(item => <article key={item.title} className="rounded-3xl border border-slate-200 bg-slate-50 p-7 dark:border-slate-800 dark:bg-slate-900">
              <div className="inline-flex rounded-2xl bg-blue-100 p-3 text-brand-700 dark:bg-blue-950 dark:text-cyan-300"><item.icon size={26} /></div>
              <h3 className="mt-6 text-2xl font-black">{item.title}</h3>
              <p className="mt-3 leading-7 text-slate-600 dark:text-slate-300">{item.description}</p>
            </article>)}
          </div>
        </section>

        <section className="bg-slate-50 py-20 dark:bg-slate-900/70">
          <div className="container-page">
            <p className="text-xs font-black uppercase tracking-[.2em] text-brand-700 dark:text-cyan-300">Built for your institution</p>
            <h2 className="mt-3 text-4xl font-black tracking-tight">School and coaching workflows are not identical.</h2>
            <div className="mt-9 grid gap-5 md:grid-cols-3">
              {workflows.map(item => <article key={item.title} className="rounded-2xl bg-white p-7 shadow-sm dark:bg-slate-950">
                <h3 className="text-xl font-black">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{item.details}</p>
              </article>)}
            </div>
          </div>
        </section>

        <section className="container-page py-20 sm:py-24" aria-labelledby="process-title">
          <p className="text-xs font-black uppercase tracking-[.2em] text-brand-700 dark:text-cyan-300">From enquiry to implementation</p>
          <h2 id="process-title" className="mt-3 text-4xl font-black tracking-tight">A clear path, without premature commitments.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {rollout.map(step => <div key={step.number} className="border-t-4 border-blue-600 pt-5">
              <span className="text-sm font-black text-brand-700 dark:text-cyan-300">{step.number}</span>
              <h3 className="mt-3 text-xl font-black">{step.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{step.detail}</p>
            </div>)}
          </div>
        </section>

        <section id="request-demo" className="scroll-mt-20 bg-slate-950 py-20 text-white sm:py-24">
          <div className="container-page grid gap-12 lg:grid-cols-[.9fr_1.1fr] lg:items-start">
            <div className="pt-3">
              <p className="text-xs font-black uppercase tracking-[.2em] text-cyan-300">Private demonstration</p>
              <h2 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">See the workflows that matter to your institution.</h2>
              <p className="mt-6 text-lg leading-8 text-slate-300">
                Share your institution type, scale and priorities. Your enquiry is routed to the existing institutional sales workflow for follow-up.
              </p>
              <div className="mt-8 space-y-4 text-sm text-slate-300">
                <p className="flex items-start gap-3"><LockKeyhole size={18} className="mt-0.5 shrink-0 text-cyan-300" /> No payment, automatic account or subscription is created.</p>
                <p className="flex items-start gap-3"><ClipboardCheck size={18} className="mt-0.5 shrink-0 text-cyan-300" /> Pricing and implementation are confirmed only after a workflow audit.</p>
              </div>
            </div>
            <SchoolOSInterestForm legalPagesPublished={legalPublished} />
          </div>
        </section>
      </main>
      <footer className="border-t border-slate-800 bg-slate-950 py-7 text-sm text-slate-300">
        <div className="container-page flex flex-col justify-between gap-3 sm:flex-row">
          <span>Adhyay SchoolOS · A product of Adhyay Eduventure Private Limited</span>
          <Link className="underline hover:text-white" href="/">Being Brilliant Education Platform</Link>
        </div>
      </footer>
    </div>
  );
}
