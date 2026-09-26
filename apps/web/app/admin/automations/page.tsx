"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, History, Pause, Play, Plus, RefreshCw, Send, Workflow } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type TriggerType = "FEE_OVERDUE" | "HOMEWORK_DUE_SOON" | "ENQUIRY_FOLLOW_UP_DUE";
type Rule = {
  id: string;
  name: string;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  actionConfig: { channels?: string[]; title?: string; body?: string };
  active: boolean;
  cooldownMinutes: number;
  lastPreviewAt?: string | null;
  lastRunAt?: string | null;
  updatedAt: string;
};
type Preview = {
  matchedCount: number;
  recipientCount: number;
  sample: Array<Record<string, unknown>>;
  runId: string;
  previewedAt: string;
};
type Run = {
  id: string;
  mode: string;
  status: string;
  matchedCount: number;
  actionCount: number;
  details?: Record<string, unknown> | null;
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
};
type DeliveryAudit = {
  dispatchId: string;
  ruleId: string;
  ruleName: string;
  triggerType: TriggerType;
  entityId: string;
  recipient: { id: string; name: string; email: string };
  title: string;
  body: string;
  createdAt: string;
  lastSentAt?: string | null;
  nextEligibleAt: string;
  channels: string[];
  inAppStatus?: string | null;
  deliveries: Array<{
    id: string;
    channel: string;
    status: string;
    attempts: number;
    provider?: string | null;
    lastError?: string | null;
    deliveredAt?: string | null;
    createdAt: string;
  }>;
};

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "Automation request failed");
  return body;
}

const labels: Record<TriggerType, string> = {
  FEE_OVERDUE: "Overdue fees",
  HOMEWORK_DUE_SOON: "Homework due soon",
  ENQUIRY_FOLLOW_UP_DUE: "Admission follow-up overdue",
};

export default function Page() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("FEE_OVERDUE");
  const [daysOverdue, setDaysOverdue] = useState("0");
  const [minBalanceRupees, setMinBalanceRupees] = useState("0");
  const [dueWithinHours, setDueWithinHours] = useState("24");
  const [followUpOverdueHours, setFollowUpOverdueHours] = useState("0");
  const [cooldownHours, setCooldownHours] = useState("24");
  const [title, setTitle] = useState("Action required");
  const [body, setBody] = useState("Please review the pending item.");
  const [email, setEmail] = useState(true);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [deliveries, setDeliveries] = useState<DeliveryAudit[]>([]);
  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveryChannel, setDeliveryChannel] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState("");
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setRules((await api("/automations")).data ?? []); }
    catch (cause) { setError(errorMessage(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadDeliveries = useCallback(async () => {
    setDeliveryBusy(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (deliverySearch.trim()) params.set("search", deliverySearch.trim());
      if (deliveryChannel) params.set("channel", deliveryChannel);
      if (deliveryStatus) params.set("status", deliveryStatus);
      setDeliveries((await api(`/automations/deliveries?${params.toString()}`)).data ?? []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDeliveryBusy(false);
    }
  }, [deliverySearch, deliveryChannel, deliveryStatus]);

  useEffect(() => { void loadDeliveries(); }, [loadDeliveries]);

  function triggerConfig() {
    if (triggerType === "FEE_OVERDUE") return {
      daysOverdue: Number(daysOverdue),
      minBalancePaise: Math.max(0, Math.round(Number(minBalanceRupees || 0) * 100)),
    };
    if (triggerType === "HOMEWORK_DUE_SOON") return { dueWithinHours: Number(dueWithinHours) };
    return { overdueHours: Number(followUpOverdueHours) };
  }

  async function createRule() {
    if (busy || name.trim().length < 2 || title.trim().length < 2 || !body.trim()) return;
    setBusy("create"); setError(""); setNotice("");
    try {
      await api("/automations", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          triggerType,
          triggerConfig: triggerConfig(),
          actionType: "NOTIFICATION",
          actionConfig: { channels: email ? ["IN_APP", "EMAIL"] : ["IN_APP"], title: title.trim(), body: body.trim() },
          cooldownMinutes: Math.max(60, Math.round(Number(cooldownHours || 24) * 60)),
          active: false,
        }),
      });
      setName("");
      setNotice("Draft automation saved. Preview it, then enable it when the matches are correct.");
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  async function preview(rule: Rule) {
    if (busy) return;
    setBusy(rule.id); setError(""); setNotice("");
    try {
      const result = (await api(`/automations/${rule.id}/preview`, { method: "POST" })).data as Preview;
      setPreviews(current => ({ ...current, [rule.id]: result }));
      setNotice(`Preview complete: ${result.matchedCount} matching item(s), ${result.recipientCount} unique recipient(s). No messages were sent.`);
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  async function toggle(rule: Rule) {
    if (busy) return;
    if (!rule.active && !rule.lastPreviewAt) {
      setError("Preview this rule before enabling it.");
      return;
    }
    if (!rule.active && !window.confirm("Enable this automation? Matching recipients can receive real notifications and email according to their preferences.")) return;
    setBusy(rule.id); setError(""); setNotice("");
    try {
      await api(`/automations/${rule.id}`, { method: "PATCH", body: JSON.stringify({ active: !rule.active }) });
      setNotice(rule.active ? "Automation paused." : "Automation enabled. Cooldown and duplicate protection are active.");
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  async function runNow(rule: Rule) {
    if (busy || !rule.active) return;
    if (!window.confirm("Run this enabled automation now? Eligible recipients may receive real notifications.")) return;
    setBusy(rule.id); setError(""); setNotice("");
    try {
      const result = (await api(`/automations/${rule.id}/run`, { method: "POST" })).data;
      setNotice(`Run finished: ${result.status}. ${result.matchedCount} match(es), ${result.actionCount} notification(s) created, ${result.cooldownSkipped} suppressed by cooldown.`);
      await Promise.all([load(), loadRuns(rule.id)]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }

  async function loadRuns(ruleId: string) {
    try {
      const data = (await api(`/automations/${ruleId}/runs`)).data ?? [];
      setRuns(current => ({ ...current, [ruleId]: data }));
    } catch (cause) { setError(errorMessage(cause)); }
  }

  return <ProtectedAdminWorkspace title="Workflow Automation" description="Preview repeatable workflows, explicitly enable them, and review every execution.">
    <section className="mt-6 card p-5">
      <div className="flex items-center gap-2"><Workflow size={19} className="text-brand-700" /><h2 className="font-semibold">New automation rule</h2></div>
      <p className="mt-1 text-sm text-slate-500">Drafts never send messages. Preview first; execution starts only after an administrator explicitly enables the rule.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm">Rule name<input className="field mt-1 w-full" value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder="Fee reminder after 3 days" /></label>
        <label className="text-sm">Trigger<select className="field mt-1 w-full" value={triggerType} onChange={event => setTriggerType(event.target.value as TriggerType)}>{(Object.keys(labels) as TriggerType[]).map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>

        {triggerType === "FEE_OVERDUE" && <>
          <label className="text-sm">Days overdue<input type="number" min={0} max={365} className="field mt-1 w-full" value={daysOverdue} onChange={event => setDaysOverdue(event.target.value)} /></label>
          <label className="text-sm">Minimum outstanding (₹)<input type="number" min={0} className="field mt-1 w-full" value={minBalanceRupees} onChange={event => setMinBalanceRupees(event.target.value)} /></label>
        </>}
        {triggerType === "HOMEWORK_DUE_SOON" && <label className="text-sm">Due within hours<input type="number" min={1} max={168} className="field mt-1 w-full" value={dueWithinHours} onChange={event => setDueWithinHours(event.target.value)} /></label>}
        {triggerType === "ENQUIRY_FOLLOW_UP_DUE" && <label className="text-sm">Follow-up overdue by hours<input type="number" min={0} max={720} className="field mt-1 w-full" value={followUpOverdueHours} onChange={event => setFollowUpOverdueHours(event.target.value)} /></label>}

        <label className="text-sm">Cooldown between repeated notifications (hours)<input type="number" min={1} max={720} className="field mt-1 w-full" value={cooldownHours} onChange={event => setCooldownHours(event.target.value)} /></label>
        <label className="text-sm">Notification title<input className="field mt-1 w-full" value={title} maxLength={120} onChange={event => setTitle(event.target.value)} /></label>
        <label className="text-sm md:col-span-2">Notification body<textarea className="field mt-1 min-h-24 w-full" value={body} maxLength={1000} onChange={event => setBody(event.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={email} onChange={event => setEmail(event.target.checked)} />Include email when enabled</label>
      </div>
      <button disabled={busy === "create" || name.trim().length < 2} onClick={() => void createRule()} className="mt-4 flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm text-white disabled:opacity-50"><Plus size={16} />Save draft rule</button>
    </section>

    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-slate-900">{notice}</p>}

    <section className="mt-6 card p-5">
      <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Automation rules</h2><p className="mt-1 text-sm text-slate-500">{rules.length} configured rule(s)</p></div><button onClick={() => void load()} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"><RefreshCw size={15} />Refresh</button></div>
      <div className="mt-4 divide-y dark:divide-slate-800">
        {rules.length === 0 && <p className="py-4 text-sm text-slate-500">No automation rules yet.</p>}
        {rules.map(rule => <article key={rule.id} className="py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><b>{rule.name}</b><span className={`rounded-full px-2 py-0.5 text-xs ${rule.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{rule.active ? "Enabled" : "Paused"}</span></div>
              <p className="mt-1 text-xs text-slate-500">{labels[rule.triggerType]} · {rule.actionConfig?.channels?.join(" + ") || "IN_APP"} · cooldown {Math.round(rule.cooldownMinutes / 60 * 10) / 10}h</p>
              {rule.lastPreviewAt && <p className="mt-1 text-xs text-slate-500">Last preview {new Date(rule.lastPreviewAt).toLocaleString()}</p>}
              {rule.lastRunAt && <p className="mt-1 text-xs text-slate-500">Last execution {new Date(rule.lastRunAt).toLocaleString()}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={Boolean(busy)} onClick={() => void preview(rule)} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><Eye size={15} />Preview matches</button>
              <button disabled={Boolean(busy)} onClick={() => void toggle(rule)} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{rule.active ? <Pause size={15} /> : <Play size={15} />}{rule.active ? "Pause" : "Enable"}</button>
              <button disabled={Boolean(busy) || !rule.active} onClick={() => void runNow(rule)} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><Send size={15} />Run now</button>
              <button disabled={Boolean(busy)} onClick={() => void loadRuns(rule.id)} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><History size={15} />History</button>
            </div>
          </div>

          {previews[rule.id] && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">
            <b>{previews[rule.id].matchedCount} matches · {previews[rule.id].recipientCount} unique recipients</b>
            <div className="mt-2 divide-y dark:divide-slate-800">{previews[rule.id].sample.map((item, index) => <div key={String(item.entityId ?? index)} className="py-2 text-xs"><span>{String(item.label ?? item.entityId ?? "Item")}</span>{item.dueAt ? <span className="ml-2 text-slate-500">Due {new Date(String(item.dueAt)).toLocaleString()}</span> : null}{item.balancePaise !== undefined ? <span className="ml-2 text-slate-500">₹{(Number(item.balancePaise) / 100).toLocaleString("en-IN")}</span> : null}</div>)}</div>
          </div>}

          {runs[rule.id] && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">
            <b>Execution history</b>
            {runs[rule.id].length === 0 ? <p className="mt-2 text-xs text-slate-500">No runs yet.</p> : <div className="mt-2 divide-y dark:divide-slate-800">{runs[rule.id].map(run => <div key={run.id} className="py-2 text-xs">
              <b>{run.mode} · {run.status}</b>
              <span className="ml-2 text-slate-500">{new Date(run.startedAt).toLocaleString()}</span>
              <span className="ml-2 text-slate-500">{run.matchedCount} matches · {run.actionCount} notifications</span>
              {run.error ? <p className="mt-1 text-red-600">{run.error}</p> : null}
            </div>)}</div>}
          </div>}
        </article>)}
      </div>
    </section>

    <section className="mt-6 card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Automation delivery audit</h2>
          <p className="mt-1 text-sm text-slate-500">Administrator view of recipients, channels, delivery status, attempts, errors and timestamps.</p>
        </div>
        <button disabled={deliveryBusy} onClick={() => void loadDeliveries()} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={15} />Refresh</button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <input value={deliverySearch} onChange={event => setDeliverySearch(event.target.value)} className="field w-full" placeholder="Search rule, recipient, email or title" />
        <select value={deliveryChannel} onChange={event => setDeliveryChannel(event.target.value)} className="field w-full">
          <option value="">All channels</option>
          <option value="IN_APP">In-app</option>
          <option value="EMAIL">Email</option>
        </select>
        <select value={deliveryStatus} onChange={event => setDeliveryStatus(event.target.value)} className="field w-full">
          <option value="">All statuses</option>
          <option value="CREATED">In-app created</option>
          <option value="QUEUED">Queued</option>
          <option value="PROCESSING">Processing</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
          <option value="DEAD_LETTER">Dead letter</option>
          <option value="SKIPPED">Skipped</option>
        </select>
      </div>

      <div className="mt-4 divide-y dark:divide-slate-800">
        {deliveryBusy && deliveries.length === 0 && <p className="py-4 text-sm text-slate-500">Loading delivery audit…</p>}
        {!deliveryBusy && deliveries.length === 0 && <p className="py-4 text-sm text-slate-500">No automation deliveries match this view.</p>}
        {deliveries.map(item => <article key={item.dispatchId} className="py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{item.recipient.name} <span className="font-normal text-slate-500">· {item.recipient.email}</span></div>
              <p className="mt-1 text-sm">{item.title}</p>
              <p className="mt-1 text-xs text-slate-500">{item.ruleName} · {labels[item.triggerType]} · created {new Date(item.createdAt).toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-500">Entity {item.entityId} · cooldown eligible again {new Date(item.nextEligibleAt).toLocaleString()}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {item.inAppStatus && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">IN_APP · {item.inAppStatus}</span>}
              {item.deliveries.map(delivery => <span key={delivery.id} className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{delivery.channel} · {delivery.status}</span>)}
            </div>
          </div>
          {item.deliveries.length > 0 && <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="text-slate-500"><tr><th className="pb-2 pr-4">Channel</th><th className="pb-2 pr-4">Status</th><th className="pb-2 pr-4">Attempts</th><th className="pb-2 pr-4">Provider</th><th className="pb-2 pr-4">Delivered</th><th className="pb-2">Error</th></tr></thead>
              <tbody>{item.deliveries.map(delivery => <tr key={delivery.id} className="border-t dark:border-slate-800"><td className="py-2 pr-4">{delivery.channel}</td><td className="py-2 pr-4">{delivery.status}</td><td className="py-2 pr-4">{delivery.attempts}</td><td className="py-2 pr-4">{delivery.provider || "—"}</td><td className="py-2 pr-4">{delivery.deliveredAt ? new Date(delivery.deliveredAt).toLocaleString() : "—"}</td><td className="py-2">{delivery.lastError || "—"}</td></tr>)}</tbody>
            </table>
          </div>}
        </article>)}
      </div>
    </section>
  </ProtectedAdminWorkspace>;
}
