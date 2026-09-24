"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Edit3, Mail, Plus, Search, School, Trash2, X } from "lucide-react";
import Image from "next/image";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";
import ImageUploadField, { fileAsBase64 } from "../../../components/image-upload-field";
import { defaultOrganizationTimezone, organizationCreationCopy, organizationGroupTerminologyOptions, organizationNameUpdate, organizationSlug } from "../../../components/organization-form";
import { isManagedOrganizationLogo, saveOrganizationLogoWorkflow } from "../../../components/organization-logo-workflow";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const subscriptionStatuses = [["TRIAL", "Trial"], ["ACTIVE", "Active"], ["PAST_DUE", "Past due"], ["SUSPENDED", "Suspended"], ["CANCELLED", "Cancelled"]] as const;
type WhiteLabelSettings = { customDomain?: string | null; [key: string]: unknown };
type OrganizationSettings = { whiteLabel?: WhiteLabelSettings; [key: string]: unknown };
type Organization = { id: string; slug: string; name: string; email: string; logoUrl: string | null; primaryColor: string; secondaryColor: string; timezone: string; locale: string; currency: string; academicYearStartMonth: number; groupLabelType: string; customGroupLabel: string | null; subscriptionStatus: string; subscriptionPlan: string; trialEndsAt: string | null; subscriptionEndsAt: string | null; settings?: OrganizationSettings; _count?: { users: number; branches: number } };
type OrganizationForm = { slug: string; name: string; email: string; adminName: string; adminEmail: string; logoUrl: string | null; primaryColor: string; secondaryColor: string; timezone: string; locale: string; currency: string; academicYearStartMonth: number; groupLabelType: string; customGroupLabel: string; subscriptionStatus: string; subscriptionPlan: string; trialEndsAt: string; subscriptionEndsAt: string; customDomain: string };
type OrganizationBranding = { logoUrl: string | null; primaryColor: string; secondaryColor: string; timezone: string; locale: string; currency: string; academicYearStartMonth: number; groupLabelType: string; customGroupLabel: string | null; settings: OrganizationSettings };
type SaaSPlan = { code: string; name: string; trialDays: number; isActive: boolean };
const empty: OrganizationForm = { slug: "", name: "", email: "", adminName: "", adminEmail: "", logoUrl: null, primaryColor: "#1d4ed8", secondaryColor: "#0f172a", timezone: defaultOrganizationTimezone, locale: "en-IN", currency: "INR", academicYearStartMonth: 4, groupLabelType: "BATCH", customGroupLabel: "", subscriptionStatus: "TRIAL", subscriptionPlan: "STANDARD", trialEndsAt: "", subscriptionEndsAt: "", customDomain: "" };
const dateInput = (value: string | null | undefined) => value ? value.slice(0, 10) : "";

async function api(path: string, init?: RequestInit) { const response = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken()}`, ...init?.headers } }); const body = response.status === 204 ? {} : await response.json(); if (!response.ok) throw new Error(body?.error?.message ?? "Request failed"); return body; }
const headersFor = (organizationId: string): RequestInit => ({ headers: { "x-organization-id": organizationId } });
async function uploadLogo(file: File, organizationId: string) { const response = await fetch(`${API}/admin/image-uploads`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}`, "x-organization-id": organizationId }, body: JSON.stringify({ kind: "organization-logo", fileName: file.name, mimeType: file.type, base64: await fileAsBase64(file) }) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error?.message ?? "Unable to upload organization logo"); return String(body.data.url); }
async function discardLogo(url: string, organizationId: string) { await fetch(`${API}/admin/image-uploads`, { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}`, "x-organization-id": organizationId }, body: JSON.stringify({ url }) }); }

export default function Page() {
  const [rows, setRows] = useState<Organization[]>([]); const [plans, setPlans] = useState<SaaSPlan[]>([]); const [search, setSearch] = useState(""); const [form, setForm] = useState<OrganizationForm>(empty); const [editing, setEditing] = useState<Organization | null>(null); const [show, setShow] = useState(false); const [slugEdited, setSlugEdited] = useState(false); const [saving, setSaving] = useState(false); const [resendingId, setResendingId] = useState<string | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [logoFile, setLogoFile] = useState<File | null>(null); const [logoError, setLogoError] = useState("");
  const load = useCallback(async () => { try { const [organizations, planResponse] = await Promise.all([api(`/platform/organizations?search=${encodeURIComponent(search)}&page=1&limit=50`), api("/platform/saas/plans")]); setRows(organizations.data); setPlans((planResponse.data ?? []).filter((plan: SaaSPlan) => plan.isActive)); setError(""); } catch (cause) { setError(errorMessage(cause)); } }, [search]);
  useEffect(() => { void load(); }, [load]);
  function openCreate() { setEditing(null); setForm(empty); setLogoFile(null); setLogoError(""); setSlugEdited(false); setError(""); setShow(true); }
  function openEdit(org: Organization) { setEditing(org); setForm({ slug: org.slug, name: org.name, email: org.email, adminName: "", adminEmail: "", logoUrl: org.logoUrl, primaryColor: org.primaryColor, secondaryColor: org.secondaryColor, timezone: org.timezone, locale: org.locale, currency: org.currency, academicYearStartMonth: org.academicYearStartMonth, groupLabelType: org.groupLabelType, customGroupLabel: org.customGroupLabel ?? "", subscriptionStatus: org.subscriptionStatus, subscriptionPlan: org.subscriptionPlan, trialEndsAt: dateInput(org.trialEndsAt), subscriptionEndsAt: dateInput(org.subscriptionEndsAt), customDomain: typeof org.settings?.whiteLabel?.customDomain === "string" ? org.settings.whiteLabel.customDomain : "" }); setLogoFile(null); setLogoError(""); setSlugEdited(true); setError(""); setShow(true); }
  function close() { setShow(false); setEditing(null); setForm(empty); setLogoFile(null); setLogoError(""); setSlugEdited(false); }
  function update<K extends keyof OrganizationForm>(key: K, value: OrganizationForm[K]) { setForm(current => ({ ...current, [key]: value })); }
  function changeName(value: string) { setForm(current => ({ ...current, ...organizationNameUpdate(current, value, slugEdited, Boolean(editing)) })); }
  function changeSlug(value: string) { setSlugEdited(true); update("slug", organizationSlug(value)); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (logoError) return;
    setSaving(true);
    setError("");
    setNotice("");
    let creationDelivery: { skipped?: boolean; reason?: string } = {};
    try {
      const terminology = { groupLabelType: form.groupLabelType, customGroupLabel: form.groupLabelType === "CUSTOM" ? form.customGroupLabel : null };
      const baseSettings = editing?.settings ?? {};
      const branding: OrganizationBranding = { logoUrl: form.logoUrl, primaryColor: form.primaryColor, secondaryColor: form.secondaryColor, timezone: form.timezone, locale: form.locale, currency: form.currency, academicYearStartMonth: Number(form.academicYearStartMonth), ...terminology, settings: { ...baseSettings, whiteLabel: { ...(baseSettings.whiteLabel ?? {}), customDomain: form.customDomain || null } } };
      const subscription = { subscriptionStatus: form.subscriptionStatus, subscriptionPlan: form.subscriptionPlan, trialEndsAt: form.trialEndsAt || null, subscriptionEndsAt: form.subscriptionEndsAt || null };
      const patchPayload = editing ? { slug: form.slug, name: form.name, email: form.email, ...branding } : { ...branding };
      const result = await saveOrganizationLogoWorkflow(
        { organizationId: editing?.id, previousLogoUrl: editing?.logoUrl, logoFile, patchPayload },
        {
          create: editing ? undefined : async () => {
            const created = await api("/platform/organizations", {
              method: "POST",
              body: JSON.stringify({
                slug: form.slug,
                name: form.name,
                email: form.email,
                ...branding,
                ...subscription,
                adminName: form.adminName,
                adminEmail: form.adminEmail,
                sendSetupEmail: true,
              }),
            });
            creationDelivery = created.data.setupDelivery ?? null;
            return { id: String(created.data.organization.id) };
          },
          patch: async (organizationId, payload) => {
            await api(`/platform/organizations/${organizationId}`, { method: "PATCH", ...headersFor(organizationId), body: JSON.stringify(payload) });
          },
          upload: uploadLogo,
          discard: discardLogo,
          isManagedLogo: isManagedOrganizationLogo,
        },
      );
      if (result.status === "created-logo-failed") {
        const createdOrganization: Organization = {
          id: result.organizationId, slug: form.slug, name: form.name, email: form.email, logoUrl: null,
          primaryColor: form.primaryColor, secondaryColor: form.secondaryColor, timezone: form.timezone, locale: form.locale,
          currency: form.currency, academicYearStartMonth: Number(form.academicYearStartMonth), groupLabelType: form.groupLabelType,
          customGroupLabel: form.groupLabelType === "CUSTOM" ? form.customGroupLabel : null, subscriptionStatus: form.subscriptionStatus,
          subscriptionPlan: form.subscriptionPlan, trialEndsAt: form.trialEndsAt || null, subscriptionEndsAt: form.subscriptionEndsAt || null,
          settings: branding.settings,
        };
        setEditing(createdOrganization);
        setForm(current => ({ ...current, logoUrl: null }));
        setNotice(creationDelivery.skipped ? "Organization created, but the admin setup email was not delivered. Fix the email provider, then use Resend setup." : "Organization created and setup email issued. Logo upload failed; retry Save Changes to attach it.");
        await load();
        setError(errorMessage(result.error));
        return;
      }
      if (editing) setNotice("Organization updated successfully.");
      else if (creationDelivery.skipped) setNotice(`Organization created. Setup email was not delivered (${creationDelivery.reason ?? "email provider unavailable"}). Use Resend setup after email is configured.`);
      else setNotice("Organization created. A secure administrator setup email was issued.");
      close();
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) { if (!confirm("Disable this organization and revoke its sessions?")) return; try { await api(`/platform/organizations/${id}`, { method: "DELETE" }); await load(); } catch (cause) { setError(errorMessage(cause)); } }
  async function resendSetup(id: string) {
    setResendingId(id);
    setError("");
    setNotice("");
    try {
      const response = await api(`/platform/organizations/${id}/admin/setup-email`, { method: "POST" });
      const delivery = response.data.delivery;
      setNotice(delivery?.skipped ? `Setup token refreshed, but email was not delivered (${delivery.reason ?? "email provider unavailable"}).` : `Secure setup email reissued to ${response.data.admin.email}.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setResendingId(null);
    }
  }
  const planOptions = plans.length ? plans.map(plan => [plan.code, `${plan.name}${plan.trialDays > 0 ? ` · ${plan.trialDays}-day trial default` : ""}`] as const) : [[form.subscriptionPlan || "STANDARD", form.subscriptionPlan || "STANDARD"] as const];
  return <ProtectedAdminWorkspace title="SaaS Organization Management" description="Provision organizations, subscriptions, tenant administrators, branding and lifecycle controls."><div className="my-6 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-3" size={17} /><input className="w-full rounded-lg border py-2.5 pl-9 dark:bg-slate-900" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search organizations" /></div><button onClick={openCreate} className="flex items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-white"><Plus size={17} />New Organization</button></div>{notice && <p className="mb-4 rounded bg-emerald-50 p-3 text-emerald-700">{notice}</p>}{error && <p role="alert" className="mb-4 rounded bg-red-50 p-3 text-red-700">{error}</p>}{show && <form onSubmit={save} className="card mb-6 grid gap-4 p-5 md:grid-cols-2"><div className="flex items-center justify-between md:col-span-2"><h2 className="text-lg font-bold">{editing ? "Edit Organization" : organizationCreationCopy.heading}</h2><button type="button" onClick={close} aria-label="Close form"><X size={18} /></button></div><Field label="Organization name" value={form.name} onChange={changeName} /><Field label="Slug" value={form.slug} onChange={changeSlug} pattern="[a-z0-9-]+" help="Lowercase letters, numbers and hyphens only." /><SelectField label="Academic group terminology" value={form.groupLabelType} placeholder="Select terminology" options={organizationGroupTerminologyOptions} onChange={value => update("groupLabelType", value)} />{form.groupLabelType === "CUSTOM" && <Field label="Custom group label" value={form.customGroupLabel} onChange={value => update("customGroupLabel", value)} minLength={2} maxLength={40} />}<Field label="Organization email" type="email" value={form.email} onChange={value => update("email", value)} />{!editing && <><Field label="Administrator name" value={form.adminName} onChange={value => update("adminName", value)} /><Field label="Administrator email" type="email" value={form.adminEmail} onChange={value => update("adminEmail", value)} /><div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300 md:col-span-2">A secure one-time setup link will be emailed to the administrator after the organization is created. Platform staff do not need to know or set the tenant administrator password.</div></>}{!editing ? <><SelectField label="Subscription status" value={form.subscriptionStatus} placeholder="Select subscription status" options={subscriptionStatuses} onChange={value => update("subscriptionStatus", value)} /><SelectField label="Subscription plan" value={form.subscriptionPlan} onChange={value => update("subscriptionPlan", value)} placeholder="Select subscription plan" options={planOptions} /><OptionalDateField label="Trial ends" value={form.trialEndsAt} onChange={value => update("trialEndsAt", value)} help="Used when status is Trial. Leave blank to use the selected plan’s default trial duration." /><OptionalDateField label="Subscription ends" value={form.subscriptionEndsAt} onChange={value => update("subscriptionEndsAt", value)} help="Access stops after this date. Leave blank for no fixed end date." /></> : <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300 md:col-span-2">Subscription plan, status, billing cycle and entitlement enforcement are managed from SaaS Billing so the organization and subscription ledger cannot drift.</div>}<Field label="Timezone" value={form.timezone} onChange={value => update("timezone", value)} /><Field label="Locale" value={form.locale} onChange={value => update("locale", value)} /><Field label="Currency" value={form.currency} onChange={value => update("currency", value.toUpperCase())} maxLength={3} /><Field label="Custom tenant domain" value={form.customDomain} onChange={value => update("customDomain", value.toLowerCase().replace(/^https?:\/\//, "").split("/")[0])} placeholder="erp.schoolname.com" help="Optional. Configure DNS and Coolify/TLS after saving. The platform blocks reserved hostnames." /><label className="text-sm font-semibold">Academic year start month<select required className="mt-1 block w-full rounded-lg border p-2.5 dark:bg-slate-900" value={form.academicYearStartMonth} onChange={event => update("academicYearStartMonth", Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Date(2000, index).toLocaleString("en", { month: "long" })}</option>)}</select></label><ImageUploadField label="Organization Logo" currentUrl={form.logoUrl} selectedFile={logoFile} disabled={saving} onFileChange={setLogoFile} onRemove={() => update("logoUrl", null)} onError={setLogoError} error={logoError} /><ColorField label="Primary color" value={form.primaryColor} onChange={value => update("primaryColor", value)} /><ColorField label="Secondary color" value={form.secondaryColor} onChange={value => update("secondaryColor", value)} /><button disabled={saving || Boolean(logoError)} className="rounded-lg bg-brand-700 p-3 font-semibold text-white disabled:opacity-50 md:col-span-2">{saving ? "Saving…" : editing ? "Save Changes" : organizationCreationCopy.submit}</button></form>}<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map(org => <article className="card p-5" key={org.id}><div className="flex items-center justify-between"><School style={{ color: org.primaryColor }} />{org.logoUrl ? <Image unoptimized src={org.logoUrl} alt="" width={40} height={40} className="h-10 w-10 rounded object-contain" /> : null}<span className="rounded-full bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{org.subscriptionStatus}</span></div><h3 className="mt-3 font-bold">{org.name}</h3><p className="text-sm text-slate-500">{org.slug} · {org.subscriptionPlan}</p><p className="mt-1 text-xs text-slate-500">Shared access: /login/admin?workspace={org.slug}</p>{typeof org.settings?.whiteLabel?.customDomain === "string" && org.settings.whiteLabel.customDomain ? <p className="mt-1 text-xs font-semibold text-brand-700">Custom URL: https://{org.settings.whiteLabel.customDomain}</p> : null}<p className="mt-3 text-xs">{org._count?.users ?? 0} users · {org._count?.branches ?? 0} branches</p>{(org.trialEndsAt || org.subscriptionEndsAt) && <p className="mt-1 text-xs text-slate-500">{org.trialEndsAt ? `Trial ends ${dateInput(org.trialEndsAt)}` : ""}{org.trialEndsAt && org.subscriptionEndsAt ? " · " : ""}{org.subscriptionEndsAt ? `Subscription ends ${dateInput(org.subscriptionEndsAt)}` : ""}</p>}<div className="mt-4 flex flex-wrap gap-4"><button onClick={() => openEdit(org)} className="flex items-center gap-2 text-sm text-brand-700"><Edit3 size={15} />Edit</button>{org.id !== "org_default" && <button disabled={resendingId === org.id} onClick={() => void resendSetup(org.id)} className="flex items-center gap-2 text-sm text-brand-700 disabled:opacity-50"><Mail size={15} />{resendingId === org.id ? "Sending…" : "Resend setup"}</button>}{org.id !== "org_default" && <button onClick={() => void remove(org.id)} className="flex items-center gap-2 text-sm text-red-600"><Trash2 size={15} />Disable</button>}</div></article>)}</div></ProtectedAdminWorkspace>;
}

function Field({ label, value, onChange, type = "text", help, minLength, maxLength, pattern }: { label: string; value: string; onChange: (value: string) => void; type?: string; help?: string; minLength?: number; maxLength?: number; pattern?: string }) { return <label className="text-sm font-semibold">{label}<input required type={type} value={value} minLength={minLength} maxLength={maxLength} pattern={pattern} onChange={event => onChange(event.target.value)} className="mt-1 block w-full rounded-lg border p-2.5 font-normal dark:bg-slate-900" />{help && <span className="mt-1 block text-xs font-normal text-slate-500">{help}</span>}</label>; }
function OptionalDateField({ label, value, onChange, help }: { label: string; value: string; onChange: (value: string) => void; help: string }) { return <label className="text-sm font-semibold">{label}<input type="date" value={value} onChange={event => onChange(event.target.value)} className="mt-1 block w-full rounded-lg border p-2.5 font-normal dark:bg-slate-900" /><span className="mt-1 block text-xs font-normal text-slate-500">{help}</span></label>; }
function SelectField({ label, value, placeholder, options, onChange }: { label: string; value: string; placeholder: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) { return <label className="text-sm font-semibold">{label}<select required value={value} onChange={event => onChange(event.target.value)} className="mt-1 block w-full rounded-lg border p-2.5 font-normal dark:bg-slate-900"><option value="" disabled>{placeholder}</option>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>; }
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-sm font-semibold">{label}<span className="mt-1 flex gap-2"><input type="color" value={value} onChange={event => onChange(event.target.value)} /><input required pattern="#[0-9a-fA-F]{6}" className="flex-1 rounded-lg border p-2 font-normal dark:bg-slate-900" value={value} onChange={event => onChange(event.target.value)} /></span></label>; }
