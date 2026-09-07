"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { submitPasswordReset, validateResetPassword } from "../../components/reset-password";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const resetToken = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
    setToken(resetToken);
    if (resetToken) window.history.replaceState(null, "", "/reset-password");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const validation = validateResetPassword(password, confirmation);
    if (!validation.valid) { setError(validation.message); return; }
    if (!token) { setError("This reset link is missing or invalid. Request a new link and try again."); return; }
    setSubmitting(true);
    try {
      await submitPasswordReset(fetch, API_URL, token, password);
      setPassword("");
      setConfirmation("");
      setToken("");
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reset the password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (complete) return <main id="main-content" className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 via-white to-orange-50 px-5 py-10 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-9"><CheckCircle2 className="mx-auto text-emerald-600" size={48} /><h1 className="mt-5 text-3xl font-bold">Password updated</h1><p className="mt-3 text-sm leading-6 text-slate-500">Your password is ready. Sign in with your email address and new password.</p><Link href="/login" className="mt-7 inline-flex w-full justify-center rounded-xl bg-brand-700 px-4 py-3 font-bold text-white">Sign In</Link></section></main>;

  const checking = token === null;
  const missing = token === "";
  return <main id="main-content" className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 via-white to-orange-50 px-5 py-10 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-9"><Link href="/" className="font-bold tracking-tight text-brand-700">BEING <span className="text-brand-orange">BRILLIANT</span></Link><div className="mt-8 grid h-12 w-12 place-items-center rounded-2xl bg-brand-700 text-white"><KeyRound size={23} /></div><h1 className="mt-5 text-3xl font-bold">Set your password</h1><p className="mt-2 text-sm leading-6 text-slate-500">Choose a secure password for your Being Brilliant Academy account.</p>{checking ? <p role="status" className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Checking your secure link…</p> : missing ? <div className="mt-6"><p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">This reset link is missing or invalid. Request a new link and try again.</p><Link href="/forgot-password" className="mt-4 inline-flex font-semibold text-brand-700">Request a new link</Link></div> : <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-semibold">New Password<input required type="password" minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 outline-none ring-brand-500 focus:ring-2 dark:border-slate-700" /></label><label className="block text-sm font-semibold">Confirm Password<input required type="password" minLength={10} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 outline-none ring-brand-500 focus:ring-2 dark:border-slate-700" /></label><p className="text-xs leading-5 text-slate-500">Use 10–128 characters with uppercase and lowercase letters and at least one number.</p>{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button disabled={submitting} className="w-full rounded-xl bg-brand-700 py-3 font-bold text-white disabled:opacity-60">{submitting ? "Updating password…" : "Set Password"}</button></form>}<p className="mt-6 text-center text-sm text-slate-500"><Link href="/login" className="font-semibold text-brand-700">Back to Sign In</Link></p></section></main>;
}
