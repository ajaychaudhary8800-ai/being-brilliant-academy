import Link from "next/link";

export default function RegisterPage() {
  return <main className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 via-white to-orange-50 px-5 py-10 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-9">
      <Link href="/" className="font-bold tracking-tight text-brand-700">BEING <span className="text-brand-orange">BRILLIANT</span></Link>
      <p className="mt-8 text-xs font-black uppercase tracking-[.2em] text-brand-700">Secure account setup</p>
      <h1 className="mt-3 text-3xl font-bold">Your institution creates your account</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Student, parent, teacher, accountant and employee access is provisioned by your school or coaching centre so the account is linked to the correct organization, branch and academic or staff profile.</p>
      <div className="mt-7 space-y-3">
        <Link href="/login" className="block rounded-xl bg-brand-700 px-4 py-3 text-center font-bold text-white">Sign in to your account</Link>
        <Link href="/forgot-password/student" className="block rounded-xl border px-4 py-3 text-center font-semibold">Set or reset your password</Link>
      </div>
      <p className="mt-6 text-sm text-slate-500">If you do not yet have an account, contact your institution administrator. Self-registration is not enabled for V2 because every account must be linked to an authorized institution record.</p>
    </section>
  </main>;
}
