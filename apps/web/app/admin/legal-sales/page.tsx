"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, FileCheck2, FileText, Printer, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken, useAuth } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type DocumentMeta = {
  id: string;
  title: string;
  file: string;
  category: string;
  generationEnabled: boolean;
  placeholders: string[];
};

type DocumentDetail = DocumentMeta & { content: string };

type ClientContext = {
  clientLegalName: string;
  institutionName: string;
  authorizedContact: string;
  clientAddress: string;
  clientGstin: string;
  plan: string;
  billingCycle: string;
  documentDate: string;
  orderNumber: string;
  proposalNumber: string;
  targetGoLive: string;
};

const blankContext: ClientContext = {
  clientLegalName: "",
  institutionName: "",
  authorizedContact: "",
  clientAddress: "",
  clientGstin: "",
  plan: "",
  billingCycle: "",
  documentDate: new Date().toISOString().slice(0, 10),
  orderNumber: "",
  proposalNumber: "",
  targetGoLive: "",
};

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${getAccessToken() ?? ""}`,
});

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function contextReplacements(context: ClientContext): Record<string, string> {
  const pairs: Array<[string, string]> = [
    ["CLIENT LEGAL NAME", context.clientLegalName],
    ["CLIENT", context.clientLegalName],
    ["INSTITUTION NAME", context.institutionName],
    ["INSTITUTION", context.institutionName],
    ["NAME / EMAIL / PHONE", context.authorizedContact],
    ["CLIENT ADDRESS", context.clientAddress],
    ["CLIENT GSTIN", context.clientGstin],
    ["ESSENTIALS / GROWTH / PROFESSIONAL / ENTERPRISE", context.plan],
    ["PLAN", context.plan],
    ["ANNUAL / MONTHLY", context.billingCycle],
    ["MONTHLY / ANNUAL", context.billingCycle],
    ["DATE", context.documentDate],
    ["PROPOSAL NUMBER", context.proposalNumber],
  ];
  return Object.fromEntries(pairs.filter(([, value]) => value.trim().length > 0));
}

export default function Page() {
  const { user } = useAuth();
  const platform = user?.role === "SUPER_ADMIN" && user.organizationId === "org_default";
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [context, setContext] = useState<ClientContext>(blankContext);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [workingContent, setWorkingContent] = useState("");
  const [workingFile, setWorkingFile] = useState("");
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDocuments = useCallback(async () => {
    if (!platform) return;
    try {
      const json = await request("/platform/legal-sales/documents");
      const rows = (json.data ?? []) as DocumentMeta[];
      setDocuments(rows);
      setSelectedId(current => current || rows[0]?.id || "");
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [platform]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!selectedId || !platform) return;
    let active = true;
    void request(`/platform/legal-sales/documents/${selectedId}`)
      .then(json => {
        if (!active) return;
        const next = json.data as DocumentDetail;
        setDetail(next);
        setWorkingContent("");
        setWorkingFile("");
        setUnresolved(next.placeholders);
        setReplacements({});
        setNotice("");
      })
      .catch(cause => active && setError(errorMessage(cause)));
    return () => {
      active = false;
    };
  }, [platform, selectedId]);

  const categories = useMemo(() => [...new Set(documents.map(document => document.category))].sort(), [documents]);
  const filtered = useMemo(() => documents.filter(document => {
    if (category && document.category !== category) return false;
    if (!query.trim()) return true;
    const term = query.toLowerCase();
    return document.title.toLowerCase().includes(term) || document.file.toLowerCase().includes(term) || document.category.toLowerCase().includes(term);
  }), [category, documents, query]);

  function updateContext<K extends keyof ClientContext>(key: K, value: ClientContext[K]) {
    setContext(current => ({ ...current, [key]: value }));
  }

  function applyContext() {
    setReplacements(current => ({ ...contextReplacements(context), ...current }));
    setNotice("Client context applied to matching placeholders. Review remaining fields before generating.");
  }

  async function generate() {
    if (!detail?.generationEnabled) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const merged = { ...contextReplacements(context), ...replacements };
      const json = await request(`/platform/legal-sales/documents/${detail.id}/generate`, {
        method: "POST",
        body: JSON.stringify({ replacements: merged }),
      });
      setWorkingContent(json.data.content);
      setWorkingFile(json.data.file);
      setUnresolved(json.data.unresolvedPlaceholders ?? []);
      setNotice("Working copy generated. The controlled source template was not changed.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const displayContent = workingContent || detail?.content || "";
  const displayFile = workingContent ? workingFile : detail?.file || "document.md";

  async function copyCurrent() {
    await navigator.clipboard.writeText(displayContent);
    setNotice("Current document copied to clipboard.");
  }

  return <ProtectedAdminWorkspace
    roles={["SUPER_ADMIN"]}
    title="Sales Documents / Legal Pack"
    description="View the controlled Step 9 commercial and legal pack, generate client working copies, and download or print documents without changing the source templates."
  >
    {!platform ? <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      This workspace is available only to the platform Super Admin.
    </div> : <div className="legal-sales-workspace mt-6 space-y-5">
      <section className="card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-brand-700"><ShieldCheck size={19}/><span className="text-xs font-bold uppercase tracking-wider">Controlled Step 9 source</span></div>
            <h2 className="mt-2 text-xl font-bold">Commercial contracting workspace</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Source documents remain read-only. Generated documents are working copies and must be reviewed before client issue or signature.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/saas-sales" className="rounded-lg border px-3 py-2 text-sm font-semibold">Open SaaS Sales</Link>
            <Link href="/admin/implementation-kit" className="rounded-lg border px-3 py-2 text-sm font-semibold">Implementation Kit</Link>
            <button type="button" onClick={() => void loadDocuments()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"><RefreshCw size={15}/>Refresh</button>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          Before external signature, verify Provider registered office, CIN, GSTIN, authorized signatory, notices/privacy contacts, support details and payment particulars, and complete Indian counsel review. Do not add unverified RPO/RTO promises while Step 5 remains incomplete.
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

      <section className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="card self-start p-4 xl:sticky xl:top-5">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-slate-400" size={16}/>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search documents..." className="field pl-9"/>
          </div>
          <select value={category} onChange={event => setCategory(event.target.value)} className="field mt-3" aria-label="Filter by category">
            <option value="">All categories</option>
            {categories.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <div className="mt-4 space-y-2">
            {filtered.map(document => <button
              type="button"
              key={document.id}
              onClick={() => setSelectedId(document.id)}
              className={`w-full rounded-xl border p-3 text-left transition ${selectedId === document.id ? "border-brand-500 bg-brand-50 dark:bg-blue-950/30" : "hover:border-brand-300"}`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-brand-700">{document.generationEnabled ? <FileCheck2 size={18}/> : <FileText size={18}/>}</span>
                <span className="min-w-0">
                  <span className="block font-semibold">{document.title}</span>
                  <span className="mt-1 block text-xs text-slate-500">{document.category} · {document.file}</span>
                </span>
              </div>
            </button>)}
            {filtered.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No documents match the filter.</p>}
          </div>
        </aside>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-lg font-bold">Client context</h2>
            <p className="mt-1 text-sm text-slate-500">Reusable details can prefill matching placeholders. Blank values are ignored.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Input label="Client legal name" value={context.clientLegalName} onChange={value => updateContext("clientLegalName", value)}/>
              <Input label="Institution / brand name" value={context.institutionName} onChange={value => updateContext("institutionName", value)}/>
              <Input label="Authorized contact (name / email / phone)" value={context.authorizedContact} onChange={value => updateContext("authorizedContact", value)}/>
              <Input label="Client GSTIN" value={context.clientGstin} onChange={value => updateContext("clientGstin", value)}/>
              <Input label="Client address" value={context.clientAddress} onChange={value => updateContext("clientAddress", value)}/>
              <label className="text-sm font-semibold">Plan<select value={context.plan} onChange={event => updateContext("plan", event.target.value)} className="field mt-1"><option value="">Select plan</option>{["ESSENTIALS","GROWTH","PROFESSIONAL","ENTERPRISE"].map(plan => <option key={plan}>{plan}</option>)}</select></label>
              <label className="text-sm font-semibold">Billing cycle<select value={context.billingCycle} onChange={event => updateContext("billingCycle", event.target.value)} className="field mt-1"><option value="">Select cycle</option><option>ANNUAL</option><option>MONTHLY</option></select></label>
              <Input label="Document date" type="date" value={context.documentDate} onChange={value => updateContext("documentDate", value)}/>
              <Input label="Order number" value={context.orderNumber} onChange={value => updateContext("orderNumber", value)}/>
              <Input label="Proposal number" value={context.proposalNumber} onChange={value => updateContext("proposalNumber", value)}/>
              <Input label="Target go-live" type="date" value={context.targetGoLive} onChange={value => updateContext("targetGoLive", value)}/>
            </div>
            <button type="button" onClick={applyContext} className="mt-4 rounded-xl border border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-700">Apply client context</button>
          </section>

          {detail && <section className="card overflow-hidden">
            <header className="border-b p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-brand-700">{detail.category}</p>
                  <h2 className="mt-1 text-2xl font-bold">{detail.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">{detail.file} · {detail.placeholders.length} placeholder types</p>
                </div>
                <div className="legal-sales-print-hide flex flex-wrap gap-2">
                  <button type="button" onClick={() => downloadText(detail.file, detail.content)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"><Download size={15}/>Source</button>
                  <button type="button" onClick={() => void copyCurrent()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"><Copy size={15}/>Copy</button>
                  {workingContent && <button type="button" onClick={() => downloadText(displayFile, workingContent)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"><Download size={15}/>Working copy</button>}
                  <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"><Printer size={15}/>Print / PDF</button>
                </div>
              </div>
            </header>

            {detail.generationEnabled && <div className="legal-sales-print-hide border-b bg-slate-50/60 p-5 dark:bg-slate-950/40">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><h3 className="font-bold">Template placeholders</h3><p className="mt-1 text-sm text-slate-500">Complete only what applies; unresolved placeholders remain visible for manual review.</p></div>
                <button type="button" disabled={busy} onClick={() => void generate()} className="rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Generating…" : workingContent ? "Regenerate working copy" : "Generate working copy"}</button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {detail.placeholders.map(token => <label key={token} className="text-xs font-semibold">
                  {token}
                  <input
                    value={replacements[token] ?? contextReplacements(context)[token] ?? ""}
                    onChange={event => setReplacements(current => ({ ...current, [token]: event.target.value }))}
                    placeholder={`[[${token}]]`}
                    className="field mt-1 text-sm"
                  />
                </label>)}
              </div>
              {unresolved.length > 0 && <p className="mt-4 text-xs text-amber-700"><b>Unresolved:</b> {unresolved.join(" · ")}</p>}
            </div>}

            <div className="p-5">
              {workingContent ? <>
                <div className="legal-sales-print-hide mb-3 flex items-center justify-between gap-3">
                  <div><h3 className="font-bold">Editable working copy</h3><p className="text-xs text-slate-500">Manual edits here do not change the controlled template.</p></div>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">WORKING COPY</span>
                </div>
                <textarea value={workingContent} onChange={event => setWorkingContent(event.target.value)} className="legal-sales-print-hide min-h-[680px] w-full rounded-xl border bg-white p-4 font-mono text-sm leading-6 dark:bg-slate-950"/>
                <pre className="legal-sales-print-content hidden whitespace-pre-wrap break-words font-sans text-sm leading-6">{workingContent}</pre>
              </> : <>
                <div className="legal-sales-print-hide mb-3"><h3 className="font-bold">Controlled source preview</h3><p className="text-xs text-slate-500">Read-only source from the Step 9 repository pack.</p></div>
                <pre className="legal-sales-print-content whitespace-pre-wrap break-words font-sans text-sm leading-6">{detail.content}</pre>
              </>}
            </div>
          </section>}
        </div>
      </section>

      <style jsx global>{`
        .field{width:100%;min-height:44px;border:1px solid #cbd5e1;border-radius:.75rem;padding:.65rem .8rem;background:white}
        .field:focus{outline:2px solid #1d4ed8;outline-offset:1px}
        .dark .field{background:#0f172a;border-color:#334155}
        @media print{
          body{background:white!important;color:#111!important}
          .admin-navigation-shell,.admin-logout,.legal-sales-print-hide{display:none!important}
          .admin-workspace-main{margin-left:0!important;padding:0!important}
          .legal-sales-workspace>section:not(:has(.legal-sales-print-content)){display:none!important}
          .legal-sales-workspace aside,.legal-sales-workspace section.card:first-child{display:none!important}
          .legal-sales-print-content{display:block!important;white-space:pre-wrap!important;font-size:11pt!important;line-height:1.45!important}
          .card{border:0!important;box-shadow:none!important}
        }
      `}</style>
    </div>}
  </ProtectedAdminWorkspace>;
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="text-sm font-semibold">{label}<input type={type} value={value} onChange={event => onChange(event.target.value)} className="field mt-1"/></label>;
}
