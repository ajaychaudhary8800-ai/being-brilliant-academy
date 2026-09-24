"use client";

import { useEffect, useMemo, useState } from "react";
import { getAccessToken } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export type LmsModuleOption = {
  id: string;
  title: string;
  position: number;
  courseId: string;
};

type Props = {
  courseId: string;
  value: string;
  modules: LmsModuleOption[];
  canManage: boolean;
  onChange: (moduleId: string) => void;
  onCreated: (module: LmsModuleOption) => void;
  onUpdated?: (module: LmsModuleOption) => void;
  onDeleted?: (moduleId: string) => void;
};

const headers = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${getAccessToken() ?? ""}`,
});

export function LmsModuleSelect({ courseId, value, modules, canManage, onChange, onCreated, onUpdated, onDeleted }: Props) {
  const available = useMemo(
    () => modules.filter((item) => item.courseId === courseId).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)),
    [courseId, modules],
  );
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [position, setPosition] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPosition, setEditPosition] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCreating(false);
    setEditingId(null);
    setTitle("");
    setPosition(available.reduce((highest, item) => Math.max(highest, item.position), 0) + 1);
    setError("");
  }, [courseId, available]);

  async function jsonResponse(response: Response) {
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.error?.message ?? "Unable to manage Module");
    return json;
  }

  async function createModule() {
    const normalizedTitle = title.trim();
    if (!courseId) return setError("Select an academic group / course first.");
    if (normalizedTitle.length < 2 || normalizedTitle.length > 150) return setError("Module title must be 2–150 characters.");
    if (!Number.isInteger(position) || position < 1) return setError("Module position must be a positive whole number.");
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API}/admin/lms/modules`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ courseId, title: normalizedTitle, position }),
      });
      const json = await jsonResponse(response);
      const createdModule = json.data as LmsModuleOption;
      onCreated(createdModule);
      onChange(createdModule.id);
      setCreating(false);
      setTitle("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create Module");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(module: LmsModuleOption) {
    setEditingId(module.id);
    setEditTitle(module.title);
    setEditPosition(module.position);
    setCreating(false);
    setError("");
  }

  async function saveModule(module: LmsModuleOption) {
    const normalizedTitle = editTitle.trim();
    if (normalizedTitle.length < 2 || normalizedTitle.length > 150) return setError("Module title must be 2–150 characters.");
    if (!Number.isInteger(editPosition) || editPosition < 1) return setError("Module position must be a positive whole number.");
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API}/admin/lms/modules/${module.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ title: normalizedTitle, position: editPosition }),
      });
      const json = await jsonResponse(response);
      onUpdated?.(json.data as LmsModuleOption);
      setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update Module");
    } finally {
      setSaving(false);
    }
  }

  async function deleteModule(module: LmsModuleOption) {
    if (!window.confirm(`Delete Module "${module.title}"? Only empty Modules can be deleted.`)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API}/admin/lms/modules/${module.id}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error?.message ?? "Unable to delete Module");
      }
      if (value === module.id) onChange("");
      onDeleted?.(module.id);
      if (editingId === module.id) setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete Module");
    } finally {
      setSaving(false);
    }
  }

  return <div>
    <label>Module<select required disabled={!courseId} className="field" value={value} onChange={(event) => onChange(event.target.value)}><option value="">{courseId ? "Select" : "Select academic group / course first"}</option>{available.map((item) => <option key={item.id} value={item.id}>{item.position}. {item.title}</option>)}</select></label>
    {courseId && available.length === 0 && <p className="mt-1 text-xs text-amber-700">No Modules exist for the selected Course.</p>}
    {courseId && canManage && !creating && <button type="button" className="mt-2 text-sm font-semibold text-brand-700" onClick={() => { setCreating(true); setEditingId(null); }}>Create Module</button>}
    {courseId && !canManage && available.length === 0 && <p className="mt-1 text-xs text-slate-500">Ask an administrator to create a Module for this Course.</p>}

    {creating && <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3">
      <label className="block text-xs font-semibold">Module title<input className="field mt-1" value={title} maxLength={150} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="block text-xs font-semibold">Position<input className="field mt-1" type="number" min={1} step={1} value={position} onChange={(event) => setPosition(Number(event.target.value))} /></label>
      <div className="flex gap-2"><button type="button" disabled={saving} className="btn bg-brand-700 text-white disabled:opacity-60" onClick={() => void createModule()}>{saving ? "Creating…" : "Create"}</button><button type="button" disabled={saving} className="btn" onClick={() => { setCreating(false); setError(""); }}>Cancel</button></div>
    </div>}

    {courseId && canManage && available.length > 0 && <div className="mt-3 rounded-lg border border-slate-200 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Manage Modules</p>
      <div className="mt-2 space-y-2">{available.map((item) => editingId === item.id
        ? <div key={item.id} className="grid gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-[1fr_90px_auto]">
            <input aria-label="Module title" className="field" value={editTitle} maxLength={150} onChange={(event) => setEditTitle(event.target.value)} />
            <input aria-label="Module position" className="field" type="number" min={1} step={1} value={editPosition} onChange={(event) => setEditPosition(Number(event.target.value))} />
            <div className="flex gap-1"><button type="button" disabled={saving} className="btn" onClick={() => void saveModule(item)}>Save</button><button type="button" disabled={saving} className="btn" onClick={() => { setEditingId(null); setError(""); }}>Cancel</button></div>
          </div>
        : <div key={item.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span><b>{item.position}.</b> {item.title}</span>
            <span className="flex gap-1"><button type="button" disabled={saving} className="btn" onClick={() => startEdit(item)}>Edit</button><button type="button" disabled={saving} className="btn text-red-700" onClick={() => void deleteModule(item)}>Delete</button></span>
          </div>)}</div>
      <p className="mt-2 text-xs text-slate-500">A Module can be deleted only after all Lessons have been moved or removed. Use an unused position when reordering.</p>
    </div>}
    {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
  </div>;
}
