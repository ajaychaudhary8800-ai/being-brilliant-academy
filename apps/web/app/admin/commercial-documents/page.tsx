"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, FileArchive, RefreshCw, ShieldCheck, Upload, XCircle } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken, useAuth } from "../../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

const documentTypes = [
  "SIGNED_ORDER_FORM",
  "SIGNED_SAAS_AGREEMENT",
  "SIGNED_SOW",
  "SIGNED_DPA",
  "INVOICE",
  "PAYMENT_EVIDENCE",
  "UAT_ACCEPTANCE",
  "HANDOVER_ACCEPTANCE",
  "OTHER",
] as const;

type Lead = {
  id: string;
  organizationName: string;
  status: string;
  recommendedPlan?: string | null;
  wonOrganizationId?: string | null;
};

type VaultDocument = {
  id: string;
  leadId: string;
  organizationId?: string | null;
  linkedOrganizationId?: string | null;
  documentType: string;
  documentReference: string;
  signedAt?: string | null;
  notes?: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentSha256: string;
  verificationStatus: string;
  verificationNotes?: string | null;
  verifiedAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  lead: {
    id: string;
    organizationName: string;
    status: string;
    wonOrganizationId?: string | null;
  };
};

const authHeaders = () => ({ Authorization: `Bearer ${getAccessToken() ?? ""}` });
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...init?.headers,
    },
  });
  const body = response.status === 204 ? {} : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  return body;
}

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      if (comma < 0) return reject(new Error("Unable to encode file"));
      resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function Page() {
  const { user } = useAuth();
  const platform = user?.role === "SUPER_ADMIN" && user.organizationId === "org_default";
  const [leads, setLeads] = useState<Lead[]>([]);
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!platform) return;
    setLoading(true);
    setError("");
    try {
      const [leadJson, documentJson] = await Promise.all([
        jsonRequest("/platform/sales/leads?limit=100"),
        jsonRequest("/platform/commercial-documents"),
      ]);
      setLeads(leadJson.data ?? []);
      setDocuments(documentJson.data ?? []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => { void load(); }, [load]);

  const filteredLeads = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? leads.filter(item => item.organizationName.toLowerCase().includes(term)) : leads;
  }, [leads, search]);

  const visibleDocuments = useMemo(
    () => selectedLeadId ? documents.filter(item => item.leadId === selectedLeadId) : documents,
    [documents, selectedLeadId],
  );

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) return setError("Select a signed PDF to upload.");
    if (file.type !== "application/pdf") return setError("Commercial evidence must be uploaded as a PDF.");
    if (file.size > 10 * 1024 * 1024) return setError("PDF size cannot exceed 10 MB.");
    const leadId = String(data.get("leadId") ?? "");
    if (!leadId) return setError("Select the client lead.");

    setBusy(true);
    setError("");
    setNotice("");
    try {
      await jsonRequest("/platform/commercial-documents", {
        method: "POST",
        body: JSON.stringify({
          leadId,
          documentType: String(data.get("documentType") ?? ""),
          documentReference: String(data.get("documentReference") ?? ""),
          signedAt: data.get("signedAt") ? String(data.get("signedAt")) : undefined,
          notes: data.get("notes") ? String(data.get("notes")) : undefined,
          fileName: file.name,
          mimeType: "application/pdf",
          base64: await fileAsBase64(file),
        }),
      });
      form.reset();
      setSelectedLeadId(leadId);
      setNotice("Signed document stored in the protected commercial vault.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verify(document: VaultDocument, status: "VERIFIED" | "REJECTED") {
    const notes = status === "REJECTED" ? window.prompt("Reason for rejection") ?? "" : "";
    if (status === "REJECTED" && !notes.trim()) return;
    setBusy(true);
    setError("");
    try {
      await jsonRequest(`/platform/commercial-documents/${document.id}/verification`, {
        method: "PATCH",
        body: JSON.stringify({ verificationStatus: status, verificationNotes: notes || undefined }),
      });
      setNotice(status === "VERIFIED" ? "Document verified." : "Document rejected.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function archive(document: VaultDocument) {
    if (!window.confirm(`Archive ${document.documentReference}? The evidence remains in the database but is hidden from the active vault.`)) return;
    setBusy(true);
    setError("");
    try {
      await jsonRequest(`/platform/commercial-documents/${document.id}/archive`, { method: "POST" });
      setNotice("Document archived.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function download(document: VaultDocument) {
    setError("");
    try {
      const response = await fetch(`${API}/platform/commercial-documents/${document.id}/download`, { headers: authHeaders() });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Unable to download document");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return <ProtectedAdminWorkspace
    roles={["SUPER_ADMIN"]}
    title="Commercial Document Vault"
    description="Securely store signed client contracts and Step-11 commercial/go-live evidence. PDF content is validated, hashed and linked to the SaaS Sales lead."
  >
    {!platform ? <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">This vault is available only to the Platform Super Admin.</div> :
    <div className="mt-6 space-y-6">
      <section className="card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-brand-700"><ShieldCheck size={18}/><span className="text-xs font-bold uppercase tracking-wider">Protected commercial evidence</span></div>
            <h2 className="mt-2 text-xl font-bold">Client Commercial Document Vault</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Upload returned signed PDFs here instead of GitHub. Files are available only to the Platform Super Admin and are tied to the real SaaS Sales lead; the customer organization is linked automatically once the lead has a WON organization.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw className={loading ? "animate-spin" : ""} size={16}/>Refresh</button>
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</p>}

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Upload size={18}/>Upload signed evidence</h2>
        <p className="mt-1 text-sm text-slate-500">Maximum 10 MB. PDF only. Keep the original physical document safely retained.</p>
        <form onSubmit={upload} className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-semibold">Client lead
            <select name="leadId" required defaultValue="" className="field mt-1">
              <option value="" disabled>Select institution</option>
              {leads.map(lead => <option key={lead.id} value={lead.id}>{lead.organizationName} · {label(lead.status)}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">Document category
            <select name="documentType" required defaultValue="SIGNED_ORDER_FORM" className="field mt-1">
              {documentTypes.map(type => <option key={type} value={type}>{label(type)}</option>)}
            </select>
          </label>
          <Input name="documentReference" labelText="Document reference" placeholder="e.g. GSWS-ORD-2026-001" required/>
          <Input name="signedAt" type="date" labelText="Signed / issued date"/>
          <label className="text-sm font-semibold md:col-span-2">Signed PDF<input name="file" type="file" accept="application/pdf,.pdf" required className="field mt-1"/></label>
          <label className="text-sm font-semibold md:col-span-2">Notes<textarea name="notes" maxLength={4000} className="field mt-1 min-h-24" placeholder="Optional execution/evidence note"/></label>
          <button disabled={busy} className="rounded-xl bg-brand-700 px-5 py-3 font-bold text-white disabled:opacity-50 md:col-span-2">{busy ? "Saving…" : "Store in vault"}</button>
        </form>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div><h2 className="flex items-center gap-2 text-lg font-bold"><FileArchive size={18}/>Stored evidence</h2><p className="mt-1 text-sm text-slate-500">{visibleDocuments.length} active document{visibleDocuments.length === 1 ? "" : "s"} shown.</p></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search institution" className="field"/>
              <select value={selectedLeadId} onChange={event => setSelectedLeadId(event.target.value)} className="field">
                <option value="">All clients</option>
                {filteredLeads.map(lead => <option key={lead.id} value={lead.id}>{lead.organizationName}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>
              <th className="p-3">Client</th><th className="p-3">Type / reference</th><th className="p-3">Date</th><th className="p-3">File</th><th className="p-3">Integrity</th><th className="p-3">Verification</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>{visibleDocuments.map(document => <tr key={document.id} className="border-t align-top">
              <td className="p-3"><b>{document.lead.organizationName}</b><div className="mt-1 text-xs text-slate-500">{document.linkedOrganizationId ? `Org: ${document.linkedOrganizationId}` : "Awaiting WON organization link"}</div></td>
              <td className="p-3"><b>{label(document.documentType)}</b><div className="mt-1 font-mono text-xs">{document.documentReference}</div>{document.notes && <div className="mt-1 max-w-xs text-xs text-slate-500">{document.notes}</div>}</td>
              <td className="p-3">{document.signedAt ? new Date(document.signedAt).toLocaleDateString("en-IN") : "—"}<div className="mt-1 text-xs text-slate-500">Uploaded {new Date(document.createdAt).toLocaleString("en-IN")}</div></td>
              <td className="p-3">{document.fileName}<div className="mt-1 text-xs text-slate-500">{(document.fileSize / 1024).toFixed(0)} KB</div></td>
              <td className="p-3 font-mono text-xs" title={document.contentSha256}>{document.contentSha256.slice(0, 12)}…</td>
              <td className="p-3">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${document.verificationStatus === "VERIFIED" ? "bg-emerald-100 text-emerald-800" : document.verificationStatus === "REJECTED" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
                  {document.verificationStatus === "VERIFIED" ? <CheckCircle2 size={13}/> : document.verificationStatus === "REJECTED" ? <XCircle size={13}/> : null}{label(document.verificationStatus)}
                </span>
                {document.verificationNotes && <div className="mt-1 max-w-xs text-xs text-slate-500">{document.verificationNotes}</div>}
              </td>
              <td className="p-3"><div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void download(document)} className="inline-flex items-center gap-1 font-semibold text-brand-700"><Download size={14}/>Download</button>
                {document.verificationStatus !== "VERIFIED" && <button type="button" disabled={busy} onClick={() => void verify(document, "VERIFIED")} className="font-semibold text-emerald-700">Verify</button>}
                {document.verificationStatus !== "REJECTED" && <button type="button" disabled={busy} onClick={() => void verify(document, "REJECTED")} className="font-semibold text-rose-700">Reject</button>}
                <button type="button" disabled={busy} onClick={() => void archive(document)} className="font-semibold text-slate-600">Archive</button>
              </div></td>
            </tr>)}
            {visibleDocuments.length === 0 && <tr><td colSpan={7} className="p-12 text-center text-slate-500">No commercial evidence has been uploaded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <style jsx global>{`.field{width:100%;min-height:44px;border:1px solid #cbd5e1;border-radius:.75rem;padding:.65rem .8rem;background:white}.field:focus{outline:2px solid #1d4ed8;outline-offset:1px}.dark .field{background:#0f172a;border-color:#334155}`}</style>
    </div>}
  </ProtectedAdminWorkspace>;
}

function Input({ name, labelText, type = "text", required = false, placeholder }: { name: string; labelText: string; type?: string; required?: boolean; placeholder?: string }) {
  return <label className="text-sm font-semibold">{labelText}<input name={name} type={type} required={required} placeholder={placeholder} className="field mt-1"/></label>;
}
