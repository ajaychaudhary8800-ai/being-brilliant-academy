"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { getAccessToken } from "./auth-provider";
import { useGroupTerminology } from "./use-group-terminology";
import { buildBulkResultsCsv, buildBulkTransitionPayload, bulkTransitionNeedsDestination, duplicateBulkRollNumbers, initialBulkRollNumbers, localResultsFilename, normalizeBulkRollNumbers, parseBulkTransitionResponse, type BulkStudent, type BulkTransitionResponse } from "./student-bulk-transition";
import { filterDestinationBatches, localCivilDate, type StudentTransitionType } from "./student-transition";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const MAX_BATCH_PAGES = 100;

type Batch = {
  id: string;
  name: string;
  branch?: { id: string; branchName?: string; name?: string };
  course?: { id: string; title: string } | null;
  academicSession?: string;
  capacity?: number;
  _count?: { students?: number };
  status?: string;
};

type Props = {
  open: boolean;
  students: BulkStudent[];
  onCancel: () => void;
  onCompletedClose: () => void;
  onRefresh: () => Promise<void> | void;
};

function authHeaders() { return { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` }; }

async function readDestinationBatches() {
  const all: Batch[] = [];
  for (let page = 1; page <= MAX_BATCH_PAGES; page += 1) {
    const response = await fetch(`${API}/admin/batches?page=${page}&limit=100`, { headers: authHeaders() });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.error?.message ?? "Destination options could not be loaded.");
    all.push(...(json?.data ?? []));
    const totalPages = Number(json?.meta?.totalPages);
    if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > MAX_BATCH_PAGES) throw new Error("Destination options could not be loaded because pagination metadata was unavailable.");
    if (page >= totalPages) return all;
  }
  throw new Error("Destination options could not be loaded because the pagination limit was reached.");
}

function transitionLabel(type: StudentTransitionType, mode: string, plural = false) {
  if (type === "PROMOTED") return mode === "SCHOOL" ? `Promote Student${plural ? "s" : ""}` : `Move / Promote Student${plural ? "s" : ""}`;
  if (type === "RETAINED") return `Retain Student${plural ? "s" : ""}`;
  if (type === "TRANSFERRED") return `Transfer Student${plural ? "s" : ""}`;
  if (type === "LEFT") return `Mark Student${plural ? "s" : ""} Left`;
  return `Mark Student${plural ? "s" : ""} Graduated`;
}

export default function StudentBulkTransitionDialog({ open, students, onCancel, onCompletedClose, onRefresh }: Props) {
  const terms = useGroupTerminology();
  const [step, setStep] = useState<"configure" | "review" | "results">("configure");
  const [type, setType] = useState<StudentTransitionType>("PROMOTED");
  const [effectiveDate, setEffectiveDate] = useState(() => localCivilDate());
  const [targetBatchId, setTargetBatchId] = useState("");
  const [reason, setReason] = useState("");
  const [rolls, setRolls] = useState<Record<string, string>>({});
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchesError, setBatchesError] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<BulkTransitionResponse | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const studentKey = students.map(student => student.id).join(",");
  const studentsForOpenRef = useRef(students);
  if (studentsForOpenRef.current.map(student => student.id).join(",") !== studentKey) studentsForOpenRef.current = students;
  const studentsForOpen = studentsForOpenRef.current;
  const hasDestination = bulkTransitionNeedsDestination(type);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStep("configure"); setType("PROMOTED"); setEffectiveDate(localCivilDate()); setTargetBatchId(""); setReason(""); setRolls(initialBulkRollNumbers(studentsForOpen)); setError(""); setResponse(null); setBatches([]); setBatchesError(""); setBatchesLoading(true);
    let active = true;
    void readDestinationBatches().then(value => { if (active) setBatches(value); }).catch(cause => { if (active) { setBatches([]); setBatchesError(cause instanceof Error ? cause.message : "Destination options could not be loaded."); } }).finally(() => { if (active) setBatchesLoading(false); });
    const timer = window.setTimeout(() => headingRef.current?.focus(), 0);
    return () => { active = false; window.clearTimeout(timer); window.setTimeout(() => { if (openerRef.current?.isConnected) openerRef.current.focus(); }, 0); };
  }, [open, studentKey, studentsForOpen]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) { if (step === "review") setStep("configure"); else if (step === "results") onCompletedClose(); else onCancel(); return; }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex=\"-1\"])");
      if (!focusable?.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel, onCompletedClose, step, submitting]);

  const sourceBatchIds = useMemo(() => students.map(student => student.currentEnrollment?.batchId ?? student.batch?.id).filter(Boolean) as string[], [students]);
  const sourceCourseIds = useMemo(() => students.map(student => student.currentEnrollment?.courseId ?? student.course?.id ?? null), [students]);
  const commonCourseId = sourceCourseIds.length === students.length && sourceCourseIds.every(Boolean) && new Set(sourceCourseIds).size === 1 ? sourceCourseIds[0] : null;
  const retainedCourseConflict = type === "RETAINED" && sourceCourseIds.every(Boolean) && new Set(sourceCourseIds).size > 1;
  const destinationBatches = useMemo(() => filterDestinationBatches(batches, type, undefined, type === "RETAINED" ? commonCourseId : null).filter(batch => !sourceBatchIds.includes(batch.id)), [batches, type, commonCourseId, sourceBatchIds]);
  const destination = destinationBatches.find(batch => batch.id === targetBatchId);

  if (!open) return null;

  const review = () => {
    setError("");
    if (!students.length) return setError("Select at least one student.");
    if (students.length > 100) return setError("Select no more than 100 students.");
    if (!effectiveDate) return setError("Select an effective date.");
    if (!hasDestination) { setStep("review"); return; }
    if (batchesLoading) return setError("Destination options are still loading. Please wait.");
    if (batchesError) return setError("Destination options could not be loaded. Reload before choosing a destination.");
    if (retainedCourseConflict) return setError("Retained students must share a compatible source course before continuing.");
    if (!destination) return setError(`Select a destination ${terms.singular.toLowerCase()}.`);
    const normalized = normalizeBulkRollNumbers(rolls);
    if (students.some(student => !normalized[student.id])) return setError("Enter a destination roll number for every selected student.");
    if (students.some(student => normalized[student.id]!.length > 30)) return setError("Destination roll numbers must be 30 characters or fewer.");
    const duplicates = duplicateBulkRollNumbers(students, rolls, type);
    if (duplicates.length) return setError(`Destination roll numbers must be unique within this selection: ${duplicates.join(", ")}.`);
    setRolls(normalized); setStep("review");
  };

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true); setError("");
    try {
      const http = await fetch(`${API}/admin/students/academic-transitions/bulk`, { method: "POST", headers: authHeaders(), body: JSON.stringify(buildBulkTransitionPayload(students, { type, effectiveDate, targetBatchId, reason }, rolls)) });
      const json = await http.json().catch(() => null);
      if (!http.ok || (http.status !== 200 && http.status !== 207)) throw new Error(json?.error?.message ?? "The bulk transition request could not be processed.");
      const processed: BulkTransitionResponse = parseBulkTransitionResponse(json, http.status, students);
      setResponse(processed); setStep("results");
      try { await onRefresh(); } catch { /* Preserve the processed report if refresh fails. */ }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The bulk transition request could not be processed."); }
    finally { setSubmitting(false); }
  };

  const exportCsv = () => {
    if (!response) return;
    const blob = new Blob([buildBulkResultsCsv(response, students, { type, effectiveDate, destinationName: destination?.name, rolls })], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = localResultsFilename(effectiveDate); anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" role="presentation"><div ref={dialogRef} className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="bulk-transition-title">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-brand-700">Bulk academic transition</p><h2 id="bulk-transition-title" ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-bold">{step === "configure" ? "Configure transition" : step === "review" ? "Review & confirm" : "Transition results"}</h2></div><button type="button" aria-label="Close bulk transition dialog" className="icon" onClick={step === "results" ? onCompletedClose : onCancel} disabled={submitting}><X size={19}/></button></div>
    {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    {step === "configure" && <div className="mt-5 space-y-4"><p className="text-sm text-slate-600">{students.length} student{students.length === 1 ? "" : "s"} selected. Configure one operation; destination roll numbers remain editable per student.</p>
      <div className="grid gap-4 md:grid-cols-2"><label className="block text-sm font-semibold">Transition type<select className="field mt-1" value={type} onChange={event => { const next = event.target.value as StudentTransitionType; setType(next); setTargetBatchId(""); }} disabled={submitting}><option value="PROMOTED">{transitionLabel("PROMOTED", terms.mode, true)}</option><option value="RETAINED">{transitionLabel("RETAINED", terms.mode, true)}</option><option value="TRANSFERRED">{transitionLabel("TRANSFERRED", terms.mode, true)}</option><option value="LEFT">{transitionLabel("LEFT", terms.mode, true)}</option><option value="GRADUATED">{transitionLabel("GRADUATED", terms.mode, true)}</option></select></label><label className="block text-sm font-semibold">Effective date<input type="date" className="field mt-1" value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} disabled={submitting}/></label></div>
      {hasDestination && <><label className="block text-sm font-semibold">Destination {terms.singular}<select className="field mt-1" value={targetBatchId} onChange={event => setTargetBatchId(event.target.value)} disabled={submitting || batchesLoading || Boolean(batchesError)}><option value="">Select destination {terms.singular.toLowerCase()}</option>{destinationBatches.map(batch => <option key={batch.id} value={batch.id}>{batch.branch?.branchName ?? batch.branch?.name ?? "Branch"} · {batch.course?.title ?? terms.course} · {batch.name} · {batch.academicSession ?? "Session"}{batch.capacity !== undefined ? ` (${batch._count?.students ?? 0}/${batch.capacity})` : ""}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Displayed capacity is informational; final validation occurs on the server.</span></label>{batchesLoading && <p className="rounded-lg bg-slate-100 p-3 text-sm" role="status">Loading destination options…</p>}{batchesError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{batchesError}</p>}{retainedCourseConflict && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">Retained students have different source courses and cannot share one retained destination.</p>}</>}
      {hasDestination && <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase"><tr><th scope="col" className="px-3 py-3">Student</th><th scope="col" className="px-3">Current roll</th><th scope="col" className="px-3">Current placement</th><th scope="col" className="px-3">Destination roll</th></tr></thead><tbody>{students.map(student => <tr key={student.id} className="border-t"><td className="px-3 py-3 font-semibold">{student.user.name}</td><td className="px-3">{student.currentEnrollment?.rollNo ?? student.rollNo ?? "—"}</td><td className="px-3">{student.branch?.name ?? "—"} · {student.course?.title ?? terms.course} · {student.batch?.name ?? terms.singular}</td><td className="px-3"><label className="sr-only" htmlFor={`bulk-roll-${student.id}`}>Destination roll number for {student.user.name}</label><input id={`bulk-roll-${student.id}`} className="field" value={rolls[student.id] ?? ""} onChange={event => setRolls(current => ({ ...current, [student.id]: event.target.value }))} maxLength={30} disabled={submitting}/></td></tr>)}</tbody></table></div>}
      <label className="block text-sm font-semibold">Reason <span className="font-normal text-slate-500">(optional)</span><textarea className="field mt-1 min-h-24" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} disabled={submitting}/></label>
      {(type === "LEFT" || type === "GRADUATED") && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">After confirmation, each current enrollment will close and no new active destination placement will be created.</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onCancel} disabled={submitting}>Cancel</button><button type="button" className="btn bg-brand-700 text-white" onClick={review} disabled={submitting}>Review transition</button></div>
    </div>}
    {step === "review" && <div className="mt-5 space-y-4"><section className="rounded-xl border border-brand-200 bg-brand-50 p-4"><h3 className="font-bold">{transitionLabel(type, terms.mode, true)}</h3><p className="mt-1 text-sm">{students.length} students · Effective {effectiveDate}</p>{destination && <p className="mt-1 text-sm">Destination: {destination.branch?.branchName ?? destination.branch?.name ?? "Branch"} · {destination.course?.title ?? terms.course} · {destination.name} · {destination.academicSession ?? "Session"}</p>}</section><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase"><tr><th scope="col" className="px-3 py-3">Student</th><th scope="col" className="px-3">Student ID</th>{hasDestination && <th scope="col" className="px-3">Destination roll</th>}</tr></thead><tbody>{students.map(student => <tr key={student.id} className="border-t"><td className="px-3 py-3">{student.user.name}</td><td className="px-3">{student.id}</td>{hasDestination && <td className="px-3">{normalizeBulkRollNumbers(rolls)[student.id]}</td>}</tr>)}</tbody></table></div>{reason.trim() && <p className="whitespace-pre-wrap rounded-lg border p-3 text-sm"><b>Reason:</b> {reason.trim()}</p>}{hasDestination ? <p className="text-xs text-slate-500">Displayed capacity is informational. The server performs final validation and partial success is possible.</p> : <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Current enrollments will close; no new active destination placement will be created.</p>}<div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setStep("configure")} disabled={submitting}>Back</button><button type="button" className="btn bg-brand-700 text-white" onClick={() => void confirm()} disabled={submitting}>{submitting ? <Loader2 size={16} className="animate-spin"/> : null}{submitting ? "Submitting…" : "Confirm bulk transition"}</button></div></div>}
    {step === "results" && response && <div className="mt-5 space-y-4"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border p-4"><p className="text-xs uppercase text-slate-500">Total</p><p className="text-2xl font-bold">{response.data.total}</p></div><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs uppercase text-emerald-700">Succeeded</p><p className="text-2xl font-bold text-emerald-800">{response.data.succeeded}</p></div><div className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-xs uppercase text-red-700">Failed</p><p className="text-2xl font-bold text-red-800">{response.data.failed}</p></div></div><div className="flex flex-wrap justify-between gap-2"><p className="text-sm text-slate-600">Processed response ({response.httpStatus}); successful rows are not automatically retried.</p><button type="button" className="btn" onClick={exportCsv}><Download size={16}/>Export results CSV</button></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase"><tr><th scope="col" className="px-3 py-3">Student</th><th scope="col" className="px-3">Type</th><th scope="col" className="px-3">Destination roll</th><th scope="col" className="px-3">Status</th><th scope="col" className="px-3">Details</th></tr></thead><tbody>{response.data.results.map(result => { const student = students.find(candidate => candidate.id === result.studentId); return <tr key={`${result.index}-${result.studentId}`} className="border-t"><td className="px-3 py-3"><b>{student?.user.name ?? result.studentId}</b><br/><span className="text-xs text-slate-500">{result.studentId}</span></td><td className="px-3">{result.transition?.type ?? type}</td><td className="px-3">{hasDestination ? normalizeBulkRollNumbers(rolls)[result.studentId] ?? "—" : "—"}</td><td className="px-3"><span className={`font-bold ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.ok ? "Success" : "Failed"}</span></td><td className="px-3">{result.ok ? `Transition ${result.transition?.id ?? "completed"}` : <><b>{result.error?.code ?? "ERROR"}</b>: {result.error?.message ?? "Unable to process this student."}</>}</td></tr>; })}</tbody></table></div><div className="flex justify-end"><button type="button" className="btn bg-brand-700 text-white" onClick={onCompletedClose}>Done</button></div></div>}
    <style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:transparent}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-size:.875rem;font-weight:700}.icon{display:inline-grid;place-items:center;border-radius:.5rem;padding:.45rem}.icon:hover{background:#eff6ff}`}</style>
  </div></div>;
}
