"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { Save, School } from "lucide-react";
import { ProtectedAdminWorkspace } from "../../../components/admin-workspace";
import { errorMessage, getAccessToken } from "../../../components/auth-provider";
import ImageUploadField, { fileAsBase64 } from "../../../components/image-upload-field";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken()}` });

async function settingsApi(init?: RequestInit) {
  const response = await fetch(`${API}/organization/settings`, { ...init, headers: headers() });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error?.message ?? "Unable to save settings");
  return json.data;
}

async function uploadLogo(file: File) {
  const response = await fetch(`${API}/admin/image-uploads`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ kind: "organization-logo", fileName: file.name, mimeType: file.type, base64: await fileAsBase64(file) }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Unable to upload institution logo");
  return String(json.data.url);
}

async function discardUpload(url: string) {
  await fetch(`${API}/admin/image-uploads`, { method: "DELETE", headers: headers(), body: JSON.stringify({ url }) });
}

function Field({ label, value, onChange, type = "text", placeholder, help }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; help?: string }) {
  return <label className="text-sm font-semibold">{label}<input type={type} className="mt-1 block w-full rounded-lg border p-2.5 dark:bg-slate-900" value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />{help ? <span className="mt-1 block text-xs font-normal text-slate-500">{help}</span> : null}</label>;
}

export default function Page() {
  const [form, setForm] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoError, setLogoError] = useState("");

  useEffect(() => { void settingsApi().then(setForm).catch(cause => setError(errorMessage(cause))); }, []);

  const whiteLabel = form?.settings?.whiteLabel ?? {};
  const update = (key: string, value: unknown) => setForm((current: any) => ({ ...current, [key]: value }));
  const updateWhiteLabel = (key: string, value: unknown) => setForm((current: any) => ({
    ...current,
    settings: {
      ...(current.settings ?? {}),
      whiteLabel: { ...(current.settings?.whiteLabel ?? {}), [key]: value },
    },
  }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (logoError) return;
    if (form.groupLabelType === "CUSTOM" && !form.customGroupLabel?.trim()) {
      setError("Enter the custom academic group label.");
      return;
    }
    setSaving(true); setMessage(""); setError("");
    let uploadedUrl: string | null = null;
    try {
      if (logoFile) uploadedUrl = await uploadLogo(logoFile);
      const updated = await settingsApi({
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          legalName: form.legalName,
          phone: form.phone,
          logoUrl: uploadedUrl ?? (form.logoUrl || null),
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          timezone: form.timezone,
          locale: form.locale,
          currency: form.currency,
          academicYearStartMonth: Number(form.academicYearStartMonth),
          groupLabelType: form.groupLabelType,
          customGroupLabel: form.groupLabelType === "CUSTOM" ? form.customGroupLabel : null,
          settings: form.settings ?? {},
        }),
      });
      setForm(updated); setLogoFile(null); setMessage("Branding and institution settings saved.");
    } catch (cause) {
      if (uploadedUrl) await discardUpload(uploadedUrl).catch(() => undefined);
      setError(errorMessage(cause));
    } finally { setSaving(false); }
  }

  if (!form) return <ProtectedAdminWorkspace title="Institution Settings" description="Loading tenant configuration."><p className="mt-6">{error || "Loading…"}</p></ProtectedAdminWorkspace>;

  const displayName = whiteLabel.appName?.trim() || form.name;
  const previewAccent = /^#[0-9a-fA-F]{6}$/.test(whiteLabel.accentColor ?? "") ? whiteLabel.accentColor : "#ff7a00";

  return <ProtectedAdminWorkspace title="Institution Branding & Settings" description="Control tenant identity, white-label portal experience, localization and academic configuration.">
    <form onSubmit={save} className="mt-6 max-w-5xl space-y-6">
      <section className="card grid gap-4 p-6 md:grid-cols-2">
        <div className="md:col-span-2"><h2 className="text-lg font-bold">Institution identity</h2><p className="text-sm text-slate-500">Core organization details used across ERP and LMS records.</p></div>
        <Field label="Institution name" value={form.name ?? ""} onChange={value => update("name", value)} />
        <Field label="Legal name" value={form.legalName ?? ""} onChange={value => update("legalName", value)} />
        <Field label="Phone" value={form.phone ?? ""} onChange={value => update("phone", value)} />
        <Field label="Timezone" value={form.timezone ?? ""} onChange={value => update("timezone", value)} />
        <Field label="Locale" value={form.locale ?? ""} onChange={value => update("locale", value)} />
        <Field label="Currency" value={form.currency ?? ""} onChange={value => update("currency", value.toUpperCase())} />
        <Field label="Academic year start month" value={String(form.academicYearStartMonth ?? 4)} onChange={value => update("academicYearStartMonth", value)} />
        <label className="text-sm font-semibold">Academic group terminology<select className="mt-1 block w-full rounded-lg border p-2.5 dark:bg-slate-900" value={form.groupLabelType ?? "BATCH"} onChange={event => update("groupLabelType", event.target.value)}><option value="SECTION">Section (school)</option><option value="BATCH">Batch (coaching / tuition)</option><option value="GROUP">Group</option><option value="CUSTOM">Custom label</option></select></label>
        {form.groupLabelType === "CUSTOM" && <Field label="Custom group label" value={form.customGroupLabel ?? ""} onChange={value => update("customGroupLabel", value)} placeholder="e.g. Learning Group" />}
      </section>

      <section className="card grid gap-4 p-6 md:grid-cols-2">
        <div className="md:col-span-2"><h2 className="text-lg font-bold">White-label brand</h2><p className="text-sm text-slate-500">These values replace Being Brilliant identity inside this tenant&apos;s login and administration experience.</p></div>
        <ImageUploadField label="Institution Logo" currentUrl={form.logoUrl || null} selectedFile={logoFile} disabled={saving} onFileChange={setLogoFile} onRemove={() => update("logoUrl", null)} onError={setLogoError} error={logoError} />
        <div className="grid gap-4">
          <Field label="Product / app name" value={whiteLabel.appName ?? ""} onChange={value => updateWhiteLabel("appName", value)} placeholder={form.name} />
          <Field label="Portal label" value={whiteLabel.portalName ?? ""} onChange={value => updateWhiteLabel("portalName", value)} placeholder="Admin Portal" />
        </div>
        <label className="text-sm font-semibold">Primary color<span className="mt-1 flex gap-2"><input aria-label="Primary color picker" type="color" value={form.primaryColor} onChange={event => update("primaryColor", event.target.value)} /><input className="flex-1 rounded-lg border p-2 dark:bg-slate-900" value={form.primaryColor} onChange={event => update("primaryColor", event.target.value)} /></span></label>
        <label className="text-sm font-semibold">Secondary color<span className="mt-1 flex gap-2"><input aria-label="Secondary color picker" type="color" value={form.secondaryColor} onChange={event => update("secondaryColor", event.target.value)} /><input className="flex-1 rounded-lg border p-2 dark:bg-slate-900" value={form.secondaryColor} onChange={event => update("secondaryColor", event.target.value)} /></span></label>
        <label className="text-sm font-semibold">Accent color<span className="mt-1 flex gap-2"><input aria-label="Accent color picker" type="color" value={previewAccent} onChange={event => updateWhiteLabel("accentColor", event.target.value)} /><input className="flex-1 rounded-lg border p-2 dark:bg-slate-900" value={whiteLabel.accentColor ?? "#ff7a00"} onChange={event => updateWhiteLabel("accentColor", event.target.value)} /></span></label>
        <Field label="Favicon URL" value={whiteLabel.faviconUrl ?? ""} onChange={value => updateWhiteLabel("faviconUrl", value)} placeholder="Use logo automatically when blank" help="Accepts an HTTPS URL or an app-relative path." />
        <Field label="Login headline" value={whiteLabel.loginHeadline ?? ""} onChange={value => updateWhiteLabel("loginHeadline", value)} placeholder="Welcome back" />
        <Field label="Login subheadline" value={whiteLabel.loginSubheadline ?? ""} onChange={value => updateWhiteLabel("loginSubheadline", value)} placeholder="Sign in to continue." />
        <Field label="Support email" type="email" value={whiteLabel.supportEmail ?? ""} onChange={value => updateWhiteLabel("supportEmail", value)} />
        <Field label="Support phone" value={whiteLabel.supportPhone ?? ""} onChange={value => updateWhiteLabel("supportPhone", value)} />
        <Field label="Custom domain" value={whiteLabel.customDomain ?? ""} onChange={value => updateWhiteLabel("customDomain", value.toLowerCase().replace(/^https?:\/\//, "").split("/")[0])} placeholder="erp.yourschool.com" help="Application mapping is enabled here; DNS and TLS still need to point this domain to the deployment." />
        <label className="flex items-center gap-3 rounded-xl border p-4 text-sm font-semibold md:col-span-2"><input type="checkbox" checked={whiteLabel.hideVendorBranding !== false} onChange={event => updateWhiteLabel("hideVendorBranding", event.target.checked)} />Hide platform vendor branding in tenant-facing surfaces</label>

        <div className="overflow-hidden rounded-2xl border md:col-span-2">
          <div className="flex min-h-44 items-center gap-5 p-6 text-white" style={{ background: `linear-gradient(135deg,${form.primaryColor},${form.secondaryColor})` }}>
            {form.logoUrl ? <Image unoptimized src={form.logoUrl} alt="" width={72} height={72} className="h-18 w-18 rounded-xl bg-white object-contain p-1" /> : <span className="grid h-16 w-16 place-items-center rounded-xl bg-white/15"><School size={32}/></span>}
            <div><span className="text-xs font-bold uppercase tracking-[.2em]" style={{ color: previewAccent }}>{whiteLabel.portalName || "Admin Portal"}</span><b className="mt-2 block text-2xl">{displayName}</b><span className="mt-1 block text-sm opacity-80">{whiteLabel.loginHeadline || "Welcome back"}</span></div>
          </div>
        </div>
      </section>

      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={saving || Boolean(logoError)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 p-3 font-semibold text-white disabled:opacity-50"><Save size={17} />{saving ? "Saving…" : "Save branding & settings"}</button>
    </form>
  </ProtectedAdminWorkspace>;
}
