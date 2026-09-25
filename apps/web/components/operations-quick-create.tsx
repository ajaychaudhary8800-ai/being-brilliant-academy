"use client";

import { FormEvent, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { errorMessage, getAccessToken } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export type QuickCreateOption = { value: string; label: string };
export type QuickCreateField = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "select";
  required?: boolean;
  placeholder?: string;
  min?: number;
  step?: number;
  options?: QuickCreateOption[];
  help?: string;
};

export function OperationsQuickCreate({
  title,
  description,
  endpoint,
  fields,
  defaults = {},
  onClose,
  onCreated,
}: {
  title: string;
  description?: string;
  endpoint: string;
  fields: QuickCreateField[];
  defaults?: Record<string, string | number>;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const initial = useMemo(() => Object.fromEntries(fields.map(field => [field.name, defaults[field.name] ?? ""])), [fields, defaults]);
  const [values, setValues] = useState<Record<string, string | number>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        const raw = values[field.name];
        if (raw === "" || raw === undefined) continue;
        payload[field.name] = field.type === "number" ? Number(raw) : raw;
      }
      const response = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAccessToken() ?? ""}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Unable to create record");
      await onCreated();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4">
    <div className="w-full max-w-2xl rounded-2xl border bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between border-b p-5 dark:border-slate-800">
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18}/></button>
      </div>
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2">
        {fields.map(field => <label key={field.name} className="text-sm font-semibold">
          {field.label}
          {field.type === "select" ? <select
            required={field.required}
            value={values[field.name] ?? ""}
            onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}
            className="mt-1 block w-full rounded-xl border bg-white p-2.5 font-normal dark:bg-slate-950"
          >
            <option value="">Select {field.label.toLowerCase()}</option>
            {(field.options ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select> : <input
            required={field.required}
            type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
            min={field.min}
            step={field.step}
            placeholder={field.placeholder}
            value={values[field.name] ?? ""}
            onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}
            className="mt-1 block w-full rounded-xl border bg-white p-2.5 font-normal dark:bg-slate-950"
          />}
          {field.help && <span className="mt-1 block text-xs font-normal text-slate-500">{field.help}</span>}
        </label>)}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 border-t pt-4 sm:col-span-2 dark:border-slate-800">
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 text-sm font-semibold">Cancel</button>
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
            {saving && <Loader2 size={16} className="animate-spin"/>}{saving ? "Saving…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  </div>;
}
