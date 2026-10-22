"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, ReceiptText, Users, Building2, Download, CalendarX2, RotateCcw } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPricePaise: number;
  annualPricePaise: number;
  currency: string;
  taxRateBps: number;
  entitlements: Record<string, boolean>;
  limits: Record<string, number | null>;
};

type Invoice = {
  id: string;
  invoiceNo: string;
  amountPaise: number;
  taxPaise: number;
  totalPaise: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  providerOrderId: string | null;
};

type MeteredUsageBalance = { metric: string; periodStart: string; periodEnd: string; grantedUnits: number; consumedUnits: number; remainingUnits: number };
type MeteredUsage = { balances: MeteredUsageBalance[]; meteringConnected: boolean; activationStatus: string; financeReviewRequired: boolean; riskHolds: { invoiceId: string; latestEventType: string; openedAt: string }[] };
type RenewalReadiness = { status: string; checkoutRecommendation: string; nextRenewalAt: string | null;
  daysUntilRenewal: number | null; financeReviewRequired: boolean; expiredCreditsCarryOver: false;
  paymentRecovery: {status:string; invoiceNo:string|null; failedAttempts:number;
    retryExistingOrderAllowed:boolean; financeReconciliationRequired:boolean; gracePeriodDays:number};
  credits: { metric: string; periodStart: string; periodEnd: string; ledgerRemainingUnits: number; usableNowUnits: number; expired: boolean }[]; };

type SignedQuote = {
  id: string; quoteNo: string; status: string; planCode: string; billingCycle: string;
  totalPaise: number; validUntil: string;
  checkoutInvoice: { id: string; status: string; providerOrderId: string | null; dueAt: string | null } | null;
};

type Snapshot = {
  organization: {
    subscriptionPlan: string;
    subscriptionStatus: string;
    trialEndsAt: string | null;
    subscriptionEndsAt: string | null;
  };
  plan: Plan | null;
  subscription: {
    id: string;
    status: string;
    billingCycle: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  enforcementEnabled: boolean;
  usage: { branches: number; users: number; students: number };
  invoices: Invoice[];
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const headers = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${getAccessToken() ?? ""}`,
});

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...init?.headers } });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json.data;
}

const money = (paise: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(paise / 100);

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-bba-razorpay="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load Razorpay checkout")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.bbaRazorpay = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Razorpay checkout"));
    document.head.appendChild(script);
  });
}

export default function Page() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [signedQuotes, setSignedQuotes] = useState<SignedQuote[]>([]);
  const [meteredUsage, setMeteredUsage] = useState<MeteredUsage | null>(null);
  const [renewal, setRenewal] = useState<RenewalReadiness | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [paying, setPaying] = useState(false);
  const [changingCancellation, setChangingCancellation] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [billing, approvedQuotes, usage, readiness] = await Promise.all([
        api("/organization/subscription"),
        api("/organization/subscription/contracted-quotes"),
        api("/organization/subscription/usage-credits").catch(() => null as MeteredUsage | null),
        api("/organization/subscription/renewal-readiness").catch(() => null as RenewalReadiness | null),
      ]);
      setSignedQuotes(approvedQuotes);
      setMeteredUsage(usage);
      setRenewal(readiness);
      setSnapshot(billing);
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function checkoutSignedQuote(quote: SignedQuote) {
    setPaying(true); setError(""); setNotice("");
    try {
      await loadRazorpay();
      const result = await api("/organization/subscription/contracted-checkout", {
        method: "POST", body: JSON.stringify({ quoteId: quote.id }),
      });
      if (!window.Razorpay) throw new Error("Razorpay checkout is unavailable");
      new window.Razorpay({
        key: result.keyId, amount: result.order.amount, currency: result.order.currency,
        order_id: result.order.id, name: quote.planCode,
        description: `Signed SchoolOS order ${quote.quoteNo}`,
        handler: () => {
          setNotice("Payment submitted. The signed plan activates only after the verified payment webhook.");
          window.setTimeout(() => void load(), 1500);
        },
        theme: { color: "#1d4ed8" },
      }).open();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setPaying(false); }
  }

  async function setCancellation(cancelAtPeriodEnd: boolean) {
    setChangingCancellation(true);
    setError("");
    setNotice("");
    try {
      await api("/organization/subscription/cancellation", {
        method: "PATCH",
        body: JSON.stringify({ cancelAtPeriodEnd }),
      });
      setNotice(cancelAtPeriodEnd ? "Cancellation scheduled for the end of the current paid period." : "Scheduled cancellation removed. Your subscription will continue through its current renewal cycle.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setChangingCancellation(false);
    }
  }

  async function downloadInvoice(invoice: Invoice) {
    setDownloadingInvoiceId(invoice.id);
    setError("");
    try {
      const response = await fetch(`${API}/organization/subscription/invoices/${invoice.id}/pdf`, {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error?.message ?? "Unable to download invoice");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${invoice.invoiceNo}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDownloadingInvoiceId(null);
    }
  }

  const usage = snapshot?.usage ?? { branches: 0, users: 0, students: 0 };
  const limits = snapshot?.plan?.limits ?? {};

  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="Subscription & Billing" description="Manage your institution&apos;s Adhyay SchoolOS subscription and pay verified signed quotations.">
    {notice && <p className="mt-6 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    {renewal && <section aria-label="Contract renewal readiness" className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
      <p className="font-bold">Paid contract renewal and purchased credit expiry</p>
      <p className="mt-1">
        {renewal.status === "PAID_TERM_ACTIVE" && renewal.nextRenewalAt
          ? `Existing paid period runs through ${new Date(renewal.nextRenewalAt).toLocaleDateString("en-IN")}. A second overlapping annual signed quote is blocked to prevent duplicate billing.`
          : "No current paid term is available. A new independently signed quotation and verified payment are required."}
      </p>
      <p className="mt-1">Unused AI/video credits expire at the end of their paid term and do not automatically roll over to another term.</p>
      {renewal.financeReviewRequired && <p className="mt-2 font-semibold">Finance dispute hold: purchased credit consumption is suspended pending approved reconciliation.</p>}
      {renewal.paymentRecovery?.status === "RETRY_EXISTING_ORDER" &&
        <p className="mt-2 font-semibold">The last payment attempt failed ({renewal.paymentRecovery.failedAttempts} recorded). Retry the same existing order from your signed quotation; no new invoice was created.</p>}
      {renewal.paymentRecovery?.financeReconciliationRequired &&
        <p className="mt-2 font-semibold text-amber-900">Payment reconciliation required. Contact the platform billing team before attempting a new order.</p>}
      <p className="mt-1">Unpaid renewal grace period: disabled. No access extension or extra AI/video credits are granted by a failed payment.</p>
    </section>}
    <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Stat label="Status" value={snapshot?.organization.subscriptionStatus ?? "—"} icon={<CreditCard size={18}/>} />
      <Stat label="Plan" value={snapshot?.plan?.name ?? snapshot?.organization.subscriptionPlan ?? "—"} icon={<ReceiptText size={18}/>} />
      <Stat label="Branches" value={usageValue(usage.branches, limits.branches)} icon={<Building2 size={18}/>} />
      <Stat label="Users / Students" value={`${usageValue(usage.users, limits.users)} · ${usageValue(usage.students, limits.students)}`} icon={<Users size={18}/>} />
    </section>

    <section className="card mt-6 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Plan & renewal</h2>
          <p className="mt-1 text-sm text-slate-500">
            {snapshot?.organization.subscriptionEndsAt ? `Current access through ${new Date(snapshot.organization.subscriptionEndsAt).toLocaleDateString("en-IN")}` :
             snapshot?.organization.trialEndsAt ? `Trial through ${new Date(snapshot.organization.trialEndsAt).toLocaleDateString("en-IN")}` :
             "No fixed renewal date is currently recorded."}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${snapshot?.enforcementEnabled ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
          {snapshot?.enforcementEnabled ? "Plan limits enforced" : "Compatibility access"}
        </span>
      </div>

      <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <p className="font-semibold">Signed quotation required for all new SchoolOS subscriptions</p>
        <p className="mt-2">Payments are available only against an approved annual quotation and verified signed agreement. The signed order fixes the plan, tax, approved add-ons and total; direct checkout and self-service monthly purchases are disabled.</p>
        <p className="mt-2">Enterprise pricing is custom-quoted. If you do not see a payable signed order below, contact your Adhyay SchoolOS billing administrator.</p>
        <p className="mt-2">This platform gateway collects your institution&apos;s SaaS subscription payment. The merchant, tax invoice and contractual seller must match your approved signed order. Student and parent fee payments use your institution&apos;s separate gateway under Fees &amp; Finance.</p>
      </div>
      {snapshot?.subscription?.status === "ACTIVE" && snapshot.subscription.currentPeriodEnd && <div className="mt-5 rounded-xl border p-4">
        <p className="font-semibold">Subscription renewal</p>
        <p className="mt-1 text-sm text-slate-500">
          {snapshot.subscription.cancelAtPeriodEnd
            ? `Cancellation is scheduled after ${new Date(snapshot.subscription.currentPeriodEnd).toLocaleDateString("en-IN")}. Access remains active until then.`
            : `Your current paid period ends on ${new Date(snapshot.subscription.currentPeriodEnd).toLocaleDateString("en-IN")}.`}
        </p>
        <button
          disabled={changingCancellation}
          onClick={() => void setCancellation(!snapshot.subscription!.cancelAtPeriodEnd)}
          className="mt-3 inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {snapshot.subscription.cancelAtPeriodEnd ? <RotateCcw size={17}/> : <CalendarX2 size={17}/>}
          {changingCancellation ? "Updating…" : snapshot.subscription.cancelAtPeriodEnd ? "Keep subscription active" : "Cancel at period end"}
        </button>
      </div>}
    </section>

    {signedQuotes.length > 0 && <section className="card mt-6 overflow-hidden">
      <div className="border-b p-5">
        <h2 className="text-xl font-bold">Your signed SchoolOS quotations</h2>
        <p className="mt-1 text-sm text-slate-500">Signed annual contracts may include independently approved add-ons. The signed total cannot be modified during checkout.</p>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">
        <thead><tr><th className="p-3">Signed order</th><th className="p-3">Annual plan</th><th className="p-3">Total incl. tax</th><th className="p-3">Status</th><th className="p-3">Payment</th></tr></thead>
        <tbody>{signedQuotes.map(quote => <tr key={quote.id} className="border-t">
          <td className="p-3">{quote.quoteNo}</td><td className="p-3">{quote.planCode}</td>
          <td className="p-3">{money(quote.totalPaise)}</td><td className="p-3">{quote.status}</td>
          <td className="p-3">{quote.status === "PAID" ? "Captured and recorded" :
            <button onClick={() => void checkoutSignedQuote(quote)} disabled={paying || (quote.status === "CONTRACTED" && new Date(quote.validUntil).getTime() <= Date.now()) ||
              (quote.checkoutInvoice?.status === "OPEN" && !quote.checkoutInvoice.providerOrderId)}
              className="rounded-lg bg-brand-700 px-3 py-2 font-semibold text-white disabled:opacity-50">
              {paying ? "Preparing…" : quote.checkoutInvoice?.providerOrderId ? "Resume payment" : "Pay signed order"}
            </button>}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="border-t p-4 text-xs text-slate-500">Approved, signed and fully priced module, capacity, AI-credit and video-minute add-ons can be purchased with an eligible annual quotation. Custom work, discounts and unreconciled prices remain blocked.</p>
    </section>}

    {signedQuotes.length === 0 && <section className="card mt-6 p-5" aria-label="Signed quotations">
      <h2 className="text-xl font-bold">Signed SchoolOS quotations</h2>
      <p className="mt-2 text-sm text-slate-600">No payable signed quotations are available. Contact your platform billing administrator for an approved quotation and verified signed agreement. Do not attempt payment outside a signed order.</p>
    </section>}

    {meteredUsage?.financeReviewRequired && <div role="alert" className="mt-6 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-bold">Payment reconciliation required</p>
      <p>Refund or payment dispute evidence was received. Purchased add-on entitlements and AI/video consumption may be suspended until platform finance verification. Contact support with the relevant subscription invoice.</p>
    </div>}
    {meteredUsage && <section className="card mt-6 overflow-hidden">
      <div className="border-b p-5"><h2 className="text-xl font-bold">AI & Video Usage Credits</h2>
        <p className="mt-1 text-sm text-slate-500">Prepaid usage ledger. This preview is not yet connected to AI Examiner or live-class streaming, and does not reflect total provider usage.</p>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
        <thead><tr><th className="p-3">Service</th><th className="p-3">Valid through</th><th className="p-3">Purchased</th><th className="p-3">Consumed</th><th className="p-3">Remaining</th></tr></thead>
        <tbody>{meteredUsage.balances.map((balance, index) => <tr key={index} className="border-t">
          <td className="p-3">{balance.metric.replaceAll("_", " ")}</td><td className="p-3">{new Date(balance.periodEnd).toLocaleDateString("en-IN")}</td>
          <td className="p-3">{balance.grantedUnits}</td><td className="p-3">{balance.consumedUnits}</td>
          <td className="p-3 font-semibold">{renewal?.credits.find(c => c.metric === balance.metric && c.periodStart === balance.periodStart)?.usableNowUnits ?? balance.remainingUnits}
          {renewal?.credits.find(c => c.metric === balance.metric && c.periodStart === balance.periodStart)?.expired && <span className="ml-2 text-xs text-red-700">(expired)</span>}</td>
        </tr>)}</tbody>
      </table></div>
      {!meteredUsage.balances.length && <p className="p-4 text-sm text-slate-500">No purchased metered add-on credits are currently recorded.</p>}
    </section>}

    <section className="card mt-6 overflow-hidden">
      <div className="border-b p-5"><h2 className="text-xl font-bold">Invoices</h2><p className="mt-1 text-sm text-slate-500">Subscription invoices and payment status.</p></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:bg-slate-900"><tr><th className="p-3">Invoice</th><th className="p-3">Date</th><th className="p-3">Base</th><th className="p-3">Tax</th><th className="p-3">Total</th><th className="p-3">Status</th><th className="p-3">Document</th></tr></thead>
          <tbody>{(snapshot?.invoices ?? []).map(invoice => <tr key={invoice.id} className="border-t"><td className="p-3 font-semibold">{invoice.invoiceNo}</td><td className="p-3">{new Date(invoice.createdAt).toLocaleDateString("en-IN")}</td><td className="p-3">{money(invoice.amountPaise, invoice.currency)}</td><td className="p-3">{money(invoice.taxPaise, invoice.currency)}</td><td className="p-3 font-semibold">{money(invoice.totalPaise, invoice.currency)}</td><td className="p-3">{invoice.status}</td><td className="p-3"><button disabled={downloadingInvoiceId === invoice.id} onClick={() => void downloadInvoice(invoice)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"><Download size={14}/>{downloadingInvoiceId === invoice.id ? "Preparing…" : "PDF"}</button></td></tr>)}
          {(snapshot?.invoices?.length ?? 0) === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500">No subscription invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </ProtectedAdminWorkspace>;
}

function usageValue(current: number, limit: number | null | undefined) {
  return limit === null || limit === undefined ? String(current) : `${current} / ${limit}`;
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="card p-4"><div className="flex items-center gap-2 text-brand-700">{icon}<span className="text-xs font-bold uppercase tracking-wider">{label}</span></div><p className="mt-3 text-xl font-bold">{value}</p></div>;
}
