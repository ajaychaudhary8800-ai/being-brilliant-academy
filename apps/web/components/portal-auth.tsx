"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, GraduationCap, HeartHandshake, School, ShieldCheck, UsersRound } from "lucide-react";
import { type AppRole, type AuthPortal, errorMessage, useAuth } from "./auth-provider";

type PortalConfig = {
  title: string;
  audience: string;
  description: string;
  dashboard: string;
  roles: AppRole[];
  icon: typeof GraduationCap;
  accent: string;
  surface: string;
  ring: string;
};

const portals: Record<AuthPortal, PortalConfig> = {
  student: { title: "Student Portal", audience: "For learners", description: "Classes, homework, results and your learning journey.", dashboard: "/student", roles: ["STUDENT"], icon: GraduationCap, accent: "bg-blue-700", surface: "from-blue-50 to-cyan-50", ring: "focus:ring-blue-500" },
  parent: { title: "Parent Portal", audience: "For families", description: "Progress, attendance, fees and teacher communication.", dashboard: "/parent", roles: ["PARENT"], icon: HeartHandshake, accent: "bg-emerald-700", surface: "from-emerald-50 to-teal-50", ring: "focus:ring-emerald-500" },
  teacher: { title: "Teacher Portal", audience: "For faculty", description: "Classes, attendance, homework and student insights.", dashboard: "/teacher", roles: ["TEACHER"], icon: UsersRound, accent: "bg-violet-700", surface: "from-violet-50 to-fuchsia-50", ring: "focus:ring-violet-500" },
  admin: { title: "Admin Portal", audience: "For administrators", description: "Secure academy operations, reports and settings.", dashboard: "/admin", roles: ["SUPER_ADMIN", "BRANCH_ADMIN"], icon: ShieldCheck, accent: "bg-slate-900", surface: "from-slate-100 to-blue-50", ring: "focus:ring-slate-500" },
};

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="inline-flex items-center gap-3 font-black tracking-tight text-slate-950"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-700 text-white"><School size={21} /></span><span className={compact ? "hidden sm:inline" : ""}>BEING <span className="text-orange-700">BRILLIANT</span></span></Link>;
}

export function PortalSelection() {
  return <main id="main-content" className="min-h-screen bg-gradient-to-br from-white via-blue-50/60 to-orange-50 px-5 py-8 sm:py-12"><div className="mx-auto max-w-6xl"><header className="flex items-center justify-between"><Brand /><Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={16} /> Back to website</Link></header><section className="mx-auto mt-14 max-w-3xl text-center"><p className="text-xs font-black uppercase tracking-[.22em] text-brand-700">Secure portal access</p><h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">Choose your portal</h1><p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-600">Select the workspace assigned to your account. Your role is verified securely when you sign in.</p></section><section className="mt-12 grid gap-5 sm:grid-cols-2" aria-label="Available portals">{(Object.entries(portals) as [AuthPortal, PortalConfig][]).map(([key, portal]) => { const Icon = portal.icon; return <Link key={key} href={`/login/${key}`} className="group rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-brand-300 hover:shadow-xl"><div className={`grid h-14 w-14 place-items-center rounded-2xl text-white ${portal.accent}`}><Icon size={27} /></div><p className="mt-6 text-xs font-black uppercase tracking-widest text-slate-500">{portal.audience}</p><h2 className="mt-2 text-2xl font-black">{portal.title}</h2><p className="mt-3 leading-6 text-slate-600">{portal.description}</p><span className="mt-6 inline-flex items-center gap-2 font-bold text-brand-700">Continue <ArrowRight size={17} className="transition group-hover:translate-x-1" /></span></Link>; })}</section><p className="mt-10 text-center text-sm text-slate-500">Not sure which portal to use? Contact your academy administrator.</p></div></main>;
}

export function PortalLogin({ portal: portalKey }: { portal: AuthPortal }) {
  const portal = portals[portalKey];
  const Icon = portal.icon;
  const { login, logout } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("being-brilliant-academy");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSubmitting(true);
    try {
      const user = await login(email, password, rememberMe, organization, portalKey);
      if (!portal.roles.includes(user.role)) {
        await logout();
        throw new Error(`This account is not authorized for the ${portal.title}.`);
      }
      router.replace(portal.dashboard);
    } catch (cause) { setError(errorMessage(cause)); } finally { setSubmitting(false); }
  }

  return <main id="main-content" className={`grid min-h-screen lg:grid-cols-[.9fr_1.1fr] bg-gradient-to-br ${portal.surface}`}><aside className={`hidden p-12 text-white lg:flex lg:flex-col lg:justify-between ${portal.accent}`}><Brand compact /><div><Icon size={56} /><p className="mt-8 text-sm font-black uppercase tracking-[.2em] opacity-75">{portal.audience}</p><h1 className="mt-3 text-5xl font-black">{portal.title}</h1><p className="mt-5 max-w-lg text-lg leading-8 opacity-85">{portal.description}</p></div><p className="text-sm opacity-70">Secure · Organization-aware · Role protected</p></aside><section className="grid place-items-center px-5 py-10"><div className="w-full max-w-md"><div className="flex items-center justify-between lg:hidden"><Brand compact /><Link href="/login" className="text-sm font-bold text-slate-600">Change portal</Link></div><div className="mt-8 rounded-3xl border border-white/80 bg-white p-7 shadow-2xl shadow-slate-300/40 sm:p-9 lg:mt-0"><div className={`grid h-12 w-12 place-items-center rounded-2xl text-white ${portal.accent}`}><Icon size={23} /></div><h2 className="mt-6 text-3xl font-black">Welcome back</h2><p className="mt-2 text-sm text-slate-500">Sign in to your {portal.title.toLowerCase()}.</p><form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-semibold">School workspace<input required value={organization} onChange={(event) => setOrganization(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} autoComplete="organization" className={`mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:ring-2 ${portal.ring}`} /></label><label className="block text-sm font-semibold">Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={`mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:ring-2 ${portal.ring}`} /></label><label className="block text-sm font-semibold">Password<span className="relative mt-1.5 block"><input required type={showPassword ? "text" : "password"} minLength={8} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={`w-full rounded-xl border border-slate-300 px-3 py-2.5 pr-12 outline-none focus:ring-2 ${portal.ring}`} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label><div className="flex items-center justify-between text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> Remember me</label><Link href={`/forgot-password/${portalKey}`} className="font-bold text-brand-700">Forgot password?</Link></div>{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>}<button disabled={submitting} className={`w-full rounded-xl py-3 font-bold text-white disabled:opacity-60 ${portal.accent}`}>{submitting ? "Verifying account…" : `Sign in to ${portal.title}`}</button></form><Link href="/login" className="mt-6 flex items-center justify-center gap-2 text-sm font-bold text-slate-500"><ArrowLeft size={15} /> Choose another portal</Link></div></div></section></main>;
}

export function PortalForgotPassword({ portal: portalKey }: { portal: AuthPortal }) {
  const portal = portals[portalKey]; const Icon = portal.icon; const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState(""); const [organization, setOrganization] = useState("being-brilliant-academy"); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); setSubmitting(true); try { await requestPasswordReset(email, organization); setMessage("If an account matches that address, reset instructions are on their way."); } catch (cause) { setError(errorMessage(cause)); } finally { setSubmitting(false); } }
  return <main id="main-content" className={`grid min-h-screen place-items-center bg-gradient-to-br px-5 py-10 ${portal.surface}`}><section className="w-full max-w-md rounded-3xl border border-white bg-white p-8 shadow-2xl"><div className={`grid h-12 w-12 place-items-center rounded-2xl text-white ${portal.accent}`}><Icon /></div><h1 className="mt-6 text-3xl font-black">Reset your password</h1><p className="mt-2 text-sm leading-6 text-slate-500">Request secure reset instructions for your {portal.title.toLowerCase()} account.</p><form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-semibold">School workspace<input required value={organization} onChange={(event) => setOrganization(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-semibold">Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>{message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button disabled={submitting} className={`w-full rounded-xl py-3 font-bold text-white disabled:opacity-60 ${portal.accent}`}>{submitting ? "Sending…" : "Send reset instructions"}</button></form><Link href={`/login/${portalKey}`} className="mt-6 flex items-center justify-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={15} /> Back to {portal.title}</Link></section></main>;
}
