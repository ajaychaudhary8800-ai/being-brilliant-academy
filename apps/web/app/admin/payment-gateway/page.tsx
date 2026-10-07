"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, CreditCard, RefreshCw, ShieldCheck, WalletCards, XCircle } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type Gateway = {
  id: string;
  provider: string;
  mode: "TEST" | "LIVE";
  isEnabled: boolean;
  keyId: string;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  allowPartialPayments: boolean;
  paymentMethods: string[];
  lastVerifiedAt: string | null;
  webhookPath: string;
  createdAt: string;
  updatedAt: string;
};

type GatewayResponse = {
  encryptionReady: boolean;
  gateway: Gateway | null;
};

type Order = {
  id: string;
  amountPaise: number;
  refundedPaise: number;
  currency: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  status: string;
  failureCode: string | null;
  failureMessage: string | null;
  capturedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  fee: {
    id: string;
    feeHead: string;
    branchId: string;
    student: { id: string; admissionNo: string; user: { name: string } };
  };
  receipt: { id: string; receiptNumber: string; paymentDate: string } | null;
};

const methodOptions = ["UPI", "CARD", "NETBANKING", "WALLET"] as const;
const money = (paise: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(paise / 100);

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAccessToken() ?? ""}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json.data;
}

export default function PaymentGatewayPage() {
  const [snapshot, setSnapshot] = useState<GatewayResponse | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [mode, setMode] = useState<"TEST" | "LIVE">("TEST");
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [allowPartialPayments, setAllowPartialPayments] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(["UPI", "CARD", "NETBANKING", "WALLET"]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [publicWebhookUrl, setPublicWebhookUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const [gateway, history] = await Promise.all([
        api("/organization/payment-gateway"),
        api("/organization/payment-gateway/orders?limit=50"),
      ]);
      setSnapshot(gateway);
      setOrders(history ?? []);
      if (gateway.gateway) {
        setMode(gateway.gateway.mode);
        setKeyId(gateway.gateway.keyId);
        setAllowPartialPayments(gateway.gateway.allowPartialPayments);
        setPaymentMethods(gateway.gateway.paymentMethods?.length ? gateway.gateway.paymentMethods : ["UPI", "CARD", "NETBANKING", "WALLET"]);
      }
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const gateway = snapshot?.gateway ?? null;

  useEffect(() => {
    if (!gateway?.webhookPath) {
      setPublicWebhookUrl("");
      return;
    }
    setPublicWebhookUrl(new URL(gateway.webhookPath, window.location.origin).toString());
  }, [gateway?.webhookPath]);

  const configured = Boolean(gateway);
  const verified = Boolean(gateway?.lastVerifiedAt);
  const enabled = Boolean(gateway?.isEnabled);
  const captured = useMemo(() => orders.filter(order => order.status === "CAPTURED" || order.status === "REFUNDED").length, [orders]);
  const reviewRequired = useMemo(() => orders.filter(order => order.status === "REVIEW_REQUIRED").length, [orders]);

  function toggleMethod(method: string) {
    setPaymentMethods(current => current.includes(method) ? current.filter(item => item !== method) : [...current, method]);
  }

  async function save() {
    setBusy("save");
    setNotice("");
    setError("");
    try {
      const body = {
        mode,
        keyId: keyId.trim(),
        ...(keySecret.trim() ? { keySecret: keySecret.trim() } : {}),
        ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
        allowPartialPayments,
        paymentMethods,
      };
      await api("/organization/payment-gateway", { method: "PUT", body: JSON.stringify(body) });
      setKeySecret("");
      setWebhookSecret("");
      setNotice("Gateway configuration saved. Verify credentials before enabling online fee collection.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }

  async function verify() {
    setBusy("verify");
    setNotice("");
    setError("");
    try {
      await api("/organization/payment-gateway/verify", { method: "POST" });
      setNotice("Razorpay credentials verified successfully.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }

  async function changeStatus(isEnabled: boolean) {
    setBusy("status");
    setNotice("");
    setError("");
    try {
      await api("/organization/payment-gateway/status", {
        method: "PATCH",
        body: JSON.stringify({ isEnabled }),
      });
      setNotice(isEnabled ? "Online student/parent fee collection enabled." : "Online fee collection disabled.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }

  async function reconcile(order: Order) {
    if (!order.providerOrderId) return;
    if (!window.confirm(`Verify this order directly with Razorpay and post it to the fee ledger only if Razorpay confirms a captured payment?`)) return;
    setBusy(`reconcile:${order.id}`);
    setNotice("");
    setError("");
    try {
      const data = await api(`/organization/payment-gateway/orders/${order.id}/reconcile`, {
        method: "POST",
      });
      if (data?.reviewRequired) {
        setNotice("Razorpay data was retrieved, but this payment requires finance review before it can be posted.");
      } else if (data?.duplicate) {
        setNotice("This payment is already reconciled.");
      } else {
        setNotice("Captured Razorpay payment reconciled successfully. The fee ledger and receipt are now updated.");
      }
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }

  async function refund(order: Order) {
    const remaining = order.amountPaise - order.refundedPaise;
    if (remaining <= 0) return;
    if (!window.confirm(`Refund ${money(remaining, order.currency)} for ${order.fee.student.user.name}? The fee ledger will update only after the verified Razorpay refund webhook is processed.`)) return;
    setBusy(`refund:${order.id}`);
    setNotice("");
    setError("");
    try {
      await api(`/organization/payment-gateway/orders/${order.id}/refund`, {
        method: "POST",
        body: JSON.stringify({ amountPaise: remaining }),
      });
      setNotice("Refund requested. The ledger will update after verified Razorpay confirmation.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }

  async function copyWebhook() {
    if (!gateway?.webhookPath) return;
    const webhookUrl = publicWebhookUrl || new URL(gateway.webhookPath, window.location.origin).toString();
    await navigator.clipboard.writeText(webhookUrl);
    setNotice("Full webhook URL copied.");
  }

  return (
    <ProtectedAdminWorkspace
      roles={["SUPER_ADMIN"]}
      title="Payment Gateway"
      description="Connect the institution&apos;s own Razorpay account for student/parent fee collection. SaaS subscription payments to Adhyay remain separate under Subscription & Billing."
    >
      {notice && <p className="mt-6 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</p>}
      {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <StatusCard label="Encryption" value={snapshot?.encryptionReady ? "Ready" : "Not configured"} good={Boolean(snapshot?.encryptionReady)} />
        <StatusCard label="Gateway" value={configured ? "Configured" : "Not configured"} good={configured} />
        <StatusCard label="Credentials" value={verified ? "Verified" : "Verification required"} good={verified} />
        <StatusCard label="Online fees" value={enabled ? "Enabled" : "Disabled"} good={enabled} />
      </section>

      {!snapshot?.encryptionReady && (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <h2 className="font-bold">Server encryption key required</h2>
          <p className="mt-2 text-sm">Configure <code>PAYMENT_CREDENTIAL_ENCRYPTION_KEY</code> on the API service before saving institution-owned gateway secrets. Secrets are encrypted at rest and never returned to the browser.</p>
        </section>
      )}

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><WalletCards size={20}/></span>
            <div><h2 className="text-xl font-bold">Institution Razorpay account</h2><p className="text-sm text-slate-500">Student money settles to the institution&apos;s own merchant account.</p></div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold">Mode
              <select className="field mt-1" value={mode} onChange={event => setMode(event.target.value as "TEST" | "LIVE")}>
                <option value="TEST">Test</option>
                <option value="LIVE">Live</option>
              </select>
            </label>
            <label className="text-sm font-semibold">Razorpay Key ID
              <input className="field mt-1" value={keyId} onChange={event => setKeyId(event.target.value)} placeholder={mode === "LIVE" ? "rzp_live_..." : "rzp_test_..."} />
            </label>
            <label className="text-sm font-semibold">Key Secret
              <input type="password" className="field mt-1" value={keySecret} onChange={event => setKeySecret(event.target.value)} placeholder={gateway?.hasKeySecret ? "Leave blank to keep existing secret" : "Required"} autoComplete="new-password" />
            </label>
            <label className="text-sm font-semibold">Webhook Secret
              <input type="password" className="field mt-1" value={webhookSecret} onChange={event => setWebhookSecret(event.target.value)} placeholder={gateway?.hasWebhookSecret ? "Leave blank to keep existing secret" : "Required"} autoComplete="new-password" />
            </label>
          </div>

          <label className="mt-5 flex items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={allowPartialPayments} onChange={event => setAllowPartialPayments(event.target.checked)} />
            Allow parents/students to make partial fee payments
          </label>

          <div className="mt-5">
            <p className="text-sm font-semibold">Checkout methods</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {methodOptions.map(method => (
                <button key={method} type="button" onClick={() => toggleMethod(method)} className={`rounded-full border px-3 py-2 text-xs font-bold ${paymentMethods.includes(method) ? "border-brand-600 bg-brand-50 text-brand-700" : "text-slate-500"}`}>
                  {method}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button disabled={busy !== "" || !snapshot?.encryptionReady || paymentMethods.length === 0} onClick={() => void save()} className="btn bg-brand-700 text-white">
              <ShieldCheck size={17}/>{busy === "save" ? "Saving…" : "Save securely"}
            </button>
            <button disabled={busy !== "" || !configured} onClick={() => void verify()} className="btn">
              <RefreshCw size={17}/>{busy === "verify" ? "Verifying…" : "Verify credentials"}
            </button>
            <button disabled={busy !== "" || !verified} onClick={() => void changeStatus(!enabled)} className={`btn ${enabled ? "border-red-200 text-red-700" : "bg-emerald-700 text-white"}`}>
              {enabled ? <XCircle size={17}/> : <CheckCircle2 size={17}/>}
              {busy === "status" ? "Updating…" : enabled ? "Disable online fees" : "Enable online fees"}
            </button>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-xl font-bold">Webhook & settlement controls</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Add the generated URL in the institution&apos;s Razorpay Dashboard and subscribe to <b>payment.captured</b>, <b>payment.failed</b> and <b>refund.processed</b>.</p>
          {gateway?.webhookPath ? (
            <div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-900">
              <p className="break-all font-mono text-xs">{publicWebhookUrl || gateway.webhookPath}</p>
              <button type="button" onClick={() => void copyWebhook()} className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-brand-700"><Copy size={15}/>Copy webhook URL</button>
            </div>
          ) : <p className="mt-4 text-sm text-slate-500">Save the gateway once to generate its tenant-specific webhook URL.</p>}
          <dl className="mt-5 space-y-3 text-sm">
            <Row label="Provider" value={gateway?.provider ?? "Razorpay"} />
            <Row label="Mode" value={gateway?.mode ?? mode} />
            <Row label="Last verified" value={gateway?.lastVerifiedAt ? new Date(gateway.lastVerifiedAt).toLocaleString("en-IN") : "Not verified"} />
            <Row label="Captured / refunded orders" value={String(captured)} />
            <Row label="Review required" value={String(reviewRequired)} />
          </dl>
          {reviewRequired > 0 && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">Some captured payments need finance review because the authoritative fee balance changed before webhook reconciliation.</p>}
        </div>
      </section>

      <section className="card mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
          <div><h2 className="text-xl font-bold">Online fee transactions</h2><p className="text-sm text-slate-500">Provider order/payment IDs, verified receipts, failures, refunds and reconciliation status.</p></div>
          <button type="button" onClick={() => void load()} className="btn"><RefreshCw size={16}/>Refresh</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900"><tr>
              <th className="p-3">Student</th><th className="p-3">Fee</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Provider IDs</th><th className="p-3">Receipt</th><th className="p-3">Created</th><th className="p-3">Action</th>
            </tr></thead>
            <tbody>
              {orders.map(order => {
                const remaining = order.amountPaise - order.refundedPaise;
                return <tr key={order.id} className="border-t align-top">
                  <td className="p-3"><b>{order.fee.student.user.name}</b><br/><span className="text-xs text-slate-500">{order.fee.student.admissionNo}</span></td>
                  <td className="p-3">{order.fee.feeHead}</td>
                  <td className="p-3"><b>{money(order.amountPaise, order.currency)}</b>{order.refundedPaise > 0 && <><br/><span className="text-xs text-amber-700">Refunded {money(order.refundedPaise, order.currency)}</span></>}</td>
                  <td className="p-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{order.status}</span>{order.failureMessage && <p className="mt-2 max-w-xs text-xs text-red-700">{order.failureMessage}</p>}</td>
                  <td className="p-3 font-mono text-xs">{order.providerOrderId ?? "—"}<br/>{order.providerPaymentId ?? ""}</td>
                  <td className="p-3">{order.receipt?.receiptNumber ?? "—"}</td>
                  <td className="p-3">{new Date(order.createdAt).toLocaleString("en-IN")}</td>
                  <td className="p-3">
                    {order.status === "CAPTURED" && remaining > 0 ? (
                      <button disabled={busy !== ""} onClick={() => void refund(order)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700">
                        {busy === `refund:${order.id}` ? "Requesting…" : "Refund remaining"}
                      </button>
                    ) : order.providerOrderId && !["CAPTURED", "REFUNDED"].includes(order.status) ? (
                      <button disabled={busy !== ""} onClick={() => void reconcile(order)} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800">
                        {busy === `reconcile:${order.id}` ? "Reconciling…" : "Reconcile"}
                      </button>
                    ) : "—"}
                  </td>
                </tr>;
              })}
              {!orders.length && <tr><td colSpan={8} className="p-8 text-center text-slate-500">No online fee transactions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </ProtectedAdminWorkspace>
  );
}

function StatusCard({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <article className="card p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><div className="mt-2 flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${good ? "bg-emerald-500" : "bg-amber-500"}`}/><b>{value}</b></div></article>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b pb-2 last:border-0"><dt className="text-slate-500">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>;
}
