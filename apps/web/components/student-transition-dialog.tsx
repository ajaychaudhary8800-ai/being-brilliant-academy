"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { getAccessToken } from "./auth-provider";
import { useGroupTerminology } from "./use-group-terminology";
import { buildTransitionPayload, filterDestinationBatches, localCivilDate, normalizeTransitionRollNo, transitionErrorMessage, transitionRequiresDestination, type StudentTransitionType } from "./student-transition";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type Placement = {
  branchId: string;
  batchId: string;
  courseId: string | null;
  academicSessionId: string;
  rollNo: string;
  status?: string;
  branch?: { id?: string; name?: string; branchName?: string } | null;
  course?: { id?: string; title?: string } | null;
  batch?: { id?: string; name?: string } | null;
  academicSession?: { id?: string; name?: string } | null;
};

export type TransitionStudent = {
  id: string;
  branch: { id: string; name: string };
  course: { id: string; title: string } | null;
  batch: { id: string; name: string };
  academicSession: string;
  rollNo: string;
  currentEnrollment?: Placement | null;
};

export type TransitionBatch = {
  id: string;
  name: string;
  branch?: { id: string; name?: string; branchName?: string };
  course?: { id: string; title: string } | null;
  academicSession?: string;
  capacity?: number;
  _count?: { students?: number };
  status?: string;
};

type Props = {
  open: boolean;
  student: TransitionStudent;
  batches: TransitionBatch[];
  batchesLoading?: boolean;
  batchesError?: string;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
};

function displayBranch(placement: Placement | TransitionBatch) {
  return placement.branch?.name ?? placement.branch?.branchName ?? "—";
}

function displayCourse(placement: Placement | TransitionBatch, fallback = "—") {
  return placement.course?.title ?? fallback;
}

function displayBatch(placement: Placement | TransitionBatch, fallback = "—") {
  return ("batch" in placement ? placement.batch?.name : undefined) ?? ("name" in placement ? placement.name : fallback);
}

function displaySession(placement: Placement | TransitionBatch | null, fallback = "—") {
  if (!placement) return fallback;
  return typeof placement.academicSession === "string" ? placement.academicSession : placement.academicSession?.name ?? fallback;
}

function transitionLabel(type: StudentTransitionType, mode: string) {
  if (type === "PROMOTED") return mode === "SCHOOL" ? "Promote Student" : mode === "COACHING" ? "Move / Promote Student" : "Promote / Move Student";
  if (type === "RETAINED") return "Retain Student";
  if (type === "TRANSFERRED") return "Transfer Student";
  if (type === "LEFT") return "Mark Student Left";
  return "Mark Student Graduated";
}

function terminalWarning(type: StudentTransitionType, terms: ReturnType<typeof useGroupTerminology>) {
  if (type === "GRADUATED") return terms.mode === "SCHOOL"
    ? "After confirmation, the current enrollment will be closed and the student will be marked as graduated."
    : "After confirmation, the current enrollment will be closed and the learner will no longer have an active academic placement.";
  return "After confirmation, the current enrollment will be closed and the student will no longer have an active academic placement.";
}

export default function StudentTransitionDialog({ open, student, batches, batchesLoading = false, batchesError = "", onClose, onSuccess }: Props) {
  const terms = useGroupTerminology();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<"configure" | "review">("configure");
  const [type, setType] = useState<StudentTransitionType>("PROMOTED");
  const [effectiveDate, setEffectiveDate] = useState(() => localCivilDate());
  const [targetBatchId, setTargetBatchId] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const source = student.currentEnrollment ?? null;
  const hasDestination = transitionRequiresDestination(type);
  const sourceCourseId = source?.courseId ?? source?.course?.id ?? student.course?.id ?? null;

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStep("configure");
    setType("PROMOTED");
    setEffectiveDate(localCivilDate());
    setTargetBatchId("");
    setRollNo("");
    setReason("");
    setError("");
    const timer = window.setTimeout(() => headingRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      window.setTimeout(() => {
        if (openerRef.current?.isConnected) openerRef.current.focus();
      }, 0);
    };
  }, [open, student.id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (submitting) return;
        if (step === "review") setStep("configure");
        else onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex=\"-1\"])");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, step, submitting]);

  const destinationBatches = useMemo(() => filterDestinationBatches(batches, type, source?.batchId ?? student.batch.id, sourceCourseId), [batches, source?.batchId, sourceCourseId, student.batch.id, type]);
  const destination = destinationBatches.find(batch => batch.id === targetBatchId) ?? null;

  if (!open) return null;

  const continueToReview = () => {
    setError("");
    if (!source) return setError("No active academic placement is available. Reload the student before retrying.");
    if (!effectiveDate) return setError("Select an effective date.");
    if (hasDestination && batchesError) return setError("Destination options could not be loaded. Reload the student before retrying.");
    if (hasDestination && batchesLoading) return setError("Destination options are still loading. Please wait a moment.");
    if (hasDestination && !destination) return setError(`Select a destination ${terms.singular.toLowerCase()}.`);
    if (hasDestination && !rollNo.trim()) return setError("Enter the destination roll number.");
    setStep("review");
  };

  const confirm = async () => {
    if (!source || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${API}/admin/students/${student.id}/academic-transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` },
        body: JSON.stringify(buildTransitionPayload({ type, effectiveDate, targetBatchId, rollNo, reason })),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(transitionErrorMessage(json?.error?.code, json?.error?.message));
      await onSuccess();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete the academic transition.");
    } finally {
      setSubmitting(false);
    }
  };

  const placementRows = (placement: Placement | TransitionBatch | null, fallback?: TransitionStudent, rollOverride?: string) => [
    ["Branch / Campus", placement ? displayBranch(placement) : fallback?.branch.name ?? "—"],
    [terms.course, placement ? displayCourse(placement, fallback?.course?.title ?? "—") : fallback?.course?.title ?? "—"],
    [terms.singular, placement ? displayBatch(placement, fallback?.batch.name ?? "—") : fallback?.batch.name ?? "—"],
    ["Session", placement ? displaySession(placement, fallback?.academicSession ?? "—") : fallback?.academicSession ?? "—"],
    ["Roll No.", rollOverride ?? (placement && "rollNo" in placement ? placement.rollNo : fallback?.rollNo ?? "—")],
  ];

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" role="presentation">
    <div ref={dialogRef} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="student-transition-title">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wide text-brand-700">Academic transition</p><h2 id="student-transition-title" ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-bold">{step === "configure" ? "Configure transition" : "Review & confirm"}</h2></div>
        <button type="button" aria-label="Close transition dialog" className="icon" onClick={onClose} disabled={submitting}><X size={19}/></button>
      </div>
      {!source && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800" role="status">No active academic placement is available. Reload the student before starting a transition.</p>}
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {step === "configure" ? <div className="mt-5 space-y-4">
        <section className="rounded-xl border bg-slate-50 p-4 dark:bg-slate-950"><h3 className="text-sm font-bold">CURRENT placement</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{placementRows(source, student).map(([label, value]) => <div key={label}><p className="text-xs font-semibold uppercase text-slate-400">{label}</p><p className="font-semibold">{value}</p></div>)}</div></section>
        <label className="block text-sm font-semibold">Transition type<select className="field mt-1" value={type} onChange={event => { const next = event.target.value as StudentTransitionType; setType(next); if (!transitionRequiresDestination(next)) { setTargetBatchId(""); setRollNo(""); } }} disabled={submitting}><option value="PROMOTED">{transitionLabel("PROMOTED", terms.mode)}</option><option value="RETAINED">Retain Student</option><option value="TRANSFERRED">Transfer Student</option><option value="LEFT">Mark Student Left</option><option value="GRADUATED">Mark Student Graduated</option></select></label>
        <label className="block text-sm font-semibold">Effective date<input className="field mt-1" type="date" value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} disabled={submitting}/></label>
        {hasDestination && batchesError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">Destination options could not be loaded. Reload the student before retrying.</p>}
        {hasDestination && batchesLoading && !batchesError && <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700" role="status">Loading destination options…</p>}
        {hasDestination && !batchesLoading && !batchesError && !destinationBatches.length && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800" role="status">No valid destination {terms.singular.toLowerCase()} options are available.</p>}
        {hasDestination && <>
          <label className="block text-sm font-semibold">Destination {terms.singular}<select className="field mt-1" value={targetBatchId} onChange={event => setTargetBatchId(event.target.value)} disabled={submitting || batchesLoading || Boolean(batchesError)}><option value="">Select destination {terms.singular.toLowerCase()}</option>{destinationBatches.map(batch => <option key={batch.id} value={batch.id}>{displayCourse(batch, terms.course)} — {batch.name} · {batch.academicSession ?? "Session"}{batch.capacity !== undefined ? ` (${batch._count?.students ?? 0}/${batch.capacity})` : ""}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Displayed capacity is informational. The transition API remains authoritative.</span></label>
          <label className="block text-sm font-semibold">Destination roll number<input className="field mt-1" value={rollNo} onChange={event => setRollNo(event.target.value)} disabled={submitting} maxLength={30}/></label>
        </>}
        <label className="block text-sm font-semibold">Reason <span className="font-normal text-slate-500">(optional)</span><textarea className="field mt-1 min-h-24" value={reason} onChange={event => setReason(event.target.value)} disabled={submitting} maxLength={2000}/></label>
        {(type === "LEFT" || type === "GRADUATED") && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">{terminalWarning(type, terms)}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn" onClick={onClose} disabled={submitting}>Cancel</button><button type="button" className="btn bg-brand-700 text-white" onClick={continueToReview} disabled={submitting || !source}>Review transition</button></div>
      </div> : <div className="mt-5 space-y-4">
        <section className="rounded-xl border bg-slate-50 p-4 dark:bg-slate-950"><h3 className="text-sm font-bold">CURRENT placement</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{placementRows(source, student).map(([label, value]) => <div key={label}><p className="text-xs font-semibold uppercase text-slate-400">{label}</p><p className="font-semibold">{value}</p></div>)}</div></section>
        <section className="rounded-xl border border-brand-200 bg-brand-50 p-4"><h3 className="text-sm font-bold text-brand-900">CHANGE</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><p className="text-xs font-semibold uppercase text-slate-500">Transition</p><p className="font-semibold">{transitionLabel(type, terms.mode)}</p></div><div><p className="text-xs font-semibold uppercase text-slate-500">Effective date</p><p className="font-semibold">{effectiveDate}</p></div></div></section>
        {destination && <section className="rounded-xl border p-4"><h3 className="text-sm font-bold">DESTINATION</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{placementRows(destination, undefined, normalizeTransitionRollNo(rollNo)).map(([label, value]) => <div key={label}><p className="text-xs font-semibold uppercase text-slate-400">{label}</p><p className="font-semibold">{value}</p></div>)}</div></section>}
        {reason.trim() && <section><p className="text-xs font-semibold uppercase text-slate-400">Reason</p><p className="mt-1 whitespace-pre-wrap rounded-lg border p-3 text-sm">{reason.trim()}</p></section>}
        {(type === "LEFT" || type === "GRADUATED") && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{terminalWarning(type, terms)}</p>}
        <p className="text-xs text-slate-500">Review only shows the requested change; it does not reserve destination capacity or guarantee that the final transition will succeed.</p>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn" onClick={() => setStep("configure")} disabled={submitting}>Back</button><button type="button" className="btn bg-brand-700 text-white" onClick={() => void confirm()} disabled={submitting}>{submitting ? <Loader2 size={16} className="animate-spin"/> : null}{submitting ? "Confirming…" : "Confirm transition"}</button></div>
      </div>}
    </div>
    <style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:transparent}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-size:.875rem;font-weight:700}.icon{display:inline-grid;place-items:center;border-radius:.5rem;padding:.45rem}.icon:hover{background:#eff6ff}`}</style>
  </div>;
}
