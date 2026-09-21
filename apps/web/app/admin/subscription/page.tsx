"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [cycle, setCycle] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [paying, setPaying] = useState(false);
  const [changingCancellation, setChangingCancellation] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [billing, activePlans] = await Promise.all([
        api("/organization/subscription"),
        api("/organization/subscription/plans"),
      ]);
      setSnapshot(billing);
      setPlans(activePlans);
      setSelectedPlan((current) => current || billing.plan?.code || activePlans[0]?.code || "");
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const chosen = useMemo(() => plans.find(plan => plan.code === selectedPlan) ?? null, [plans, selectedPlan]);
  const base = chosen ? (cycle === "ANNUAL" ? chosen.annualPricePaise : chosen.monthlyPricePaise) : 0;
  const tax = chosen ? Math.round(base * chosen.taxRateBps / 10_000) : 0;
  const total = base + tax;

  async function checkout() {
    if (!chosen || total <= 0) return;
    setPaying(true);
    setError("");
    setNotice("");
    try {
      await loadRazorpay();
      const result = await api("/organization/subscription/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ planCode: chosen.code, billingCycle: cycle }),
      });
      if (!window.Razorpay) throw new Error("Razorpay checkout is unavailable");
      const checkoutInstance = new window.Razorpay({
        key: result.keyId,
        amount: result.order.amount,
        currency: result.order.currency,
        order_id: result.order.id,
        name: chosen.name,
        description: `${cycle === "ANNUAL" ? "Annual" : "Monthly"} SaaS subscription`,
        handler: () => {
          setNotice("Payment submitted. Subscription activation is confirmed by the verified payment webhook.");
          window.setTimeout(() => void load(), 1500);
        },
        theme: { color: "#1d4ed8" },
      });
      checkoutInstance.open();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPaying(false);
    }
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

  return <ProtectedAdminWorkspace roles={["SUPER_ADMIN"]} title="Subscription & Billing" description="View your SaaS plan, usage, renewal status, invoices and subscription payment options.">
    {notice && <p className="mt-6 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

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

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_220px_220px]">
        <label className="text-sm font-semibold">Plan
          <select className="mt-1 block w-full rounded-xl border p-2.5 font-normal dark:bg-slate-900" value={selectedPlan} onChange={event => setSelectedPlan(event.target.value)}>
            {plans.map(plan => <option key={plan.id} value={plan.code}>{plan.name} ({plan.code})</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Billing cycle
          <select className="mt-1 block w-full rounded-xl border p-2.5 font-normal dark:bg-slate-900" value={cycle} onChange={event => setCycle(event.target.value as "MONTHLY" | "ANNUAL")}>
            <option value="MONTHLY">Monthly</option>
            <option value="ANNUAL">Annual</option>
          </select>
        </label>
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
          <span className="text-xs text-slate-500">Payable</span>
          <p className="mt-1 text-lg font-bold">{chosen ? money(total, chosen.currency) : "—"}</p>
          {tax > 0 && <p className="text-xs text-slate-500">Includes {money(tax, chosen?.currency)} tax</p>}
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-500">{chosen?.description}</p>
      <button disabled={paying || !chosen || total <= 0} onClick={() => void checkout()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
        <CreditCard size={18}/>{paying ? "Preparing checkout…" : total <= 0 ? "Plan pricing not configured" : "Pay with Razorpay"}
      </button>
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
