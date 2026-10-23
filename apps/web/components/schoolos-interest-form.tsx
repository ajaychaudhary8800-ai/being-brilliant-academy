"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const allowedRequirements = ["lms", "crm", "finance", "examinations", "analytics", "multi_branch"] as const;

/** No payment or account creation; reuses the existing protected SaaS Sales CRM intake. */
export function SchoolOSInterestForm({ legalPagesPublished }: { legalPagesPublished: boolean }) {
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("contactConsent") !== "yes") {
      setError("Please confirm that we may contact you about your request.");
      return;
    }
    const mobile = String(data.get("mobile") ?? "").replace(/\D/g, "").replace(/^91(?=[6-9]\d{9}$)/, "");
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(API + "/public/saas-sales/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationName: String(data.get("organizationName") ?? "").trim(),
          contactName: String(data.get("contactName") ?? "").trim(),
          mobile,
          email: String(data.get("email") ?? "").trim(),
          institutionType: String(data.get("institutionType") ?? "School"),
          studentCountBand: String(data.get("studentCountBand") ?? "Under 500"),
          source: "WEBSITE",
          campaign: "SCHOOLOS_V5_PRIVATE_DEMO",
          requirements: allowedRequirements.filter(code => data.getAll("requirements").includes(code)),
          utm: { intent: "B2B_PRODUCT_DEMO", product: "ADHYAY_SCHOOLOS", stage: "PRIVATE_DEMO_ONLY" },
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error?.message ?? "Unable to submit your request.");
      setSubmitted(true);
      form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit your request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[2rem] bg-white p-6 text-slate-900 shadow-2xl sm:p-9">
      {submitted ? <div role="status" className="py-9 text-center">
        <CheckCircle2 size={46} className="mx-auto text-emerald-600" />
        <h3 className="mt-5 text-2xl font-black">Demo enquiry received.</h3>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-slate-600">
          Your request has been recorded for sales follow-up. This is not a paid subscription, booking confirmation or product-access approval.
        </p>
        <button type="button" onClick={() => setSubmitted(false)} className="mt-7 text-sm font-bold text-brand-700 underline">Submit another enquiry</button>
      </div> : <>
        <h3 className="text-2xl font-black">Request a SchoolOS demo</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">For school owners, principals and coaching/training institute operators.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>Contact name<input required minLength={2} maxLength={120} name="contactName" autoComplete="name" className="form-input" /></label>
            <label>Institution name<input required minLength={2} maxLength={160} name="organizationName" autoComplete="organization" className="form-input" /></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>Business mobile<input required name="mobile" inputMode="tel" autoComplete="tel" className="form-input" /></label>
            <label>Work email<input required type="email" maxLength={180} name="email" autoComplete="email" className="form-input" /></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>Institution type<select name="institutionType" className="form-input">
              <option>School</option><option>Coaching Institute</option><option>Training Institute</option><option>Education Group</option>
            </select></label>
            <label>Approximate students<select name="studentCountBand" className="form-input">
              <option>Under 500</option><option>500–2,000</option><option>2,000–5,000</option><option>5,000+</option>
            </select></label>
          </div>
          <fieldset>
            <legend className="text-sm font-semibold">Priority workflows (optional)</legend>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {[
                { value:"lms",label:"Learning/LMS" },{ value:"crm",label:"Admissions/CRM" },
                { value:"finance",label:"Fees/finance" },{ value:"examinations",label:"Examinations" },
                { value:"analytics",label:"Management reporting" },{ value:"multi_branch",label:"Multiple branches" },
              ].map(item => <label key={item.value} className="flex items-start gap-2 text-xs font-medium leading-5 text-slate-600">
                <input type="checkbox" name="requirements" value={item.value} className="mt-1" />{item.label}
              </label>)}
            </div>
          </fieldset>
          <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-xs font-medium leading-6 text-slate-700">
            <input type="checkbox" required name="contactConsent" value="yes" className="mt-1.5" />
            I am requesting a product demonstration and agree to be contacted about this institutional enquiry.
          </label>
          {legalPagesPublished && <p className="text-xs text-slate-500">Read our <Link href="/privacy" className="font-bold text-brand-700 underline">Privacy Notice</Link>.</p>}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 py-3.5 font-bold text-white transition hover:bg-blue-800 disabled:opacity-60">
            {busy ? "Submitting…" : <>Request private demo <ArrowRight size={18} /></>}
          </button>
          <p className="text-xs leading-5 text-slate-500">No card details or payment are requested. A sales enquiry does not create a tenant account, reserve a slot or guarantee commercial launch timing.</p>
        </form>
      </>}
    </div>
  );
}
