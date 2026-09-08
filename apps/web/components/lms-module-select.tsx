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

export function LmsModuleSelect({ courseId, value, modules, canManage, onChange, onCreated }: {
  courseId: string;
  value: string;
  modules: LmsModuleOption[];
  canManage: boolean;
  onChange: (moduleId: string) => void;
  onCreated: (module: LmsModuleOption) => void;
}) {
  const available = useMemo(() => modules.filter((item) => item.courseId === courseId), [courseId, modules]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [position, setPosition] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCreating(false);
    setTitle("");
    setPosition(available.reduce((highest, item) => Math.max(highest, item.position), 0) + 1);
    setError("");
  }, [courseId, available]);

  async function createModule() {
    const normalizedTitle = title.trim();
    if (!courseId) return setError("Select a Batch / Course first.");
    if (normalizedTitle.length < 2 || normalizedTitle.length > 150) return setError("Module title must be 2–150 characters.");
    if (!Number.isInteger(position) || position < 1) return setError("Module position must be a positive whole number.");
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API}/admin/lms/modules`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` },
        body: JSON.stringify({ courseId, title: normalizedTitle, position }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error?.message ?? "Unable to create Module");
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

  return <div>
    <label>Module<select required disabled={!courseId} className="field" value={value} onChange={(event) => onChange(event.target.value)}><option value="">{courseId ? "Select" : "Select Batch / Course first"}</option>{available.map((item) => <option key={item.id} value={item.id}>{item.position}. {item.title}</option>)}</select></label>
    {courseId && available.length === 0 && <p className="mt-1 text-xs text-amber-700">No Modules exist for the selected Course.</p>}
    {courseId && canManage && !creating && <button type="button" className="mt-2 text-sm font-semibold text-brand-700" onClick={() => setCreating(true)}>Create Module</button>}
    {courseId && !canManage && available.length === 0 && <p className="mt-1 text-xs text-slate-500">Ask an administrator to create a Module for this Course.</p>}
    {creating && <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3">
      <label className="block text-xs font-semibold">Module title<input className="field mt-1" value={title} maxLength={150} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="block text-xs font-semibold">Position<input className="field mt-1" type="number" min={1} step={1} value={position} onChange={(event) => setPosition(Number(event.target.value))} /></label>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2"><button type="button" disabled={saving} className="btn bg-brand-700 text-white disabled:opacity-60" onClick={() => void createModule()}>{saving ? "Creating…" : "Create"}</button><button type="button" disabled={saving} className="btn" onClick={() => { setCreating(false); setError(""); }}>Cancel</button></div>
    </div>}
    {!creating && error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
  </div>;
}
