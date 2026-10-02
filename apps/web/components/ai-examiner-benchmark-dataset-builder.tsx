"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { getAccessToken } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });

type Candidate = {
  sourceAnswerSheetId: string;
  questionKey: string;
  maxMarks: number;
  humanMarks: number;
  aiSuggestedMarks: number | null;
  confidence: number;
  examination: { id: string; name: string; code: string };
  student: { id: string; admissionNo: string; rollNo: string; name: string };
  fileName: string;
  finalizedAt: string | null;
  contentFingerprint: string;
  sourceEvaluationId: string;
  sourceEvaluationRevision: number;
  humanReviewerId: string | null;
  engineVersion: string;
  provider: string | null;
  model: string | null;
  alreadyAdded: boolean;
  duplicateSourceContent: boolean;
  eligible: boolean;
};

type CandidatePool = {
  suiteId: string;
  minimumCases: number;
  existingCaseCount: number;
  finalizedSourceCount: number;
  independentSourceCount: number;
  duplicateSourceCount: number;
  noApprovedEvaluationSources: number;
  noFinalQuestionMarksSources: number;
  eligibleCaseCount: number;
  candidates: Candidate[];
};

async function responseBody(response: Response) {
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}

export function AIExaminerBenchmarkDatasetBuilder({
  suiteId,
  suiteStatus,
  activeCaseCount,
  minimumCases,
  onChanged,
}: {
  suiteId: string;
  suiteStatus: "DRAFT" | "ACTIVE" | "ARCHIVED";
  activeCaseCount: number;
  minimumCases: number;
  onChanged: () => Promise<unknown>;
}) {
  const [pool, setPool] = useState<CandidatePool | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const keyFor = (candidate: Candidate) => `${candidate.sourceAnswerSheetId}:${candidate.questionKey}`;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const eligible = useMemo(() => pool?.candidates.filter(candidate => candidate.eligible) ?? [], [pool]);
  const remaining = Math.max(0, minimumCases - activeCaseCount);

  const load = useCallback(async () => {
    if (!suiteId || suiteStatus !== "DRAFT") {
      setPool(null);
      setSelected([]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const json = await fetch(`${API}/ai-examiner/benchmark-suites/${suiteId}/candidate-pool`, { headers: headers() }).then(responseBody);
      setPool(json.data as CandidatePool);
      setSelected(current => current.filter(key => (json.data.candidates as Candidate[]).some(candidate => candidate.eligible && keyFor(candidate) === key)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to scan benchmark candidates");
    } finally {
      setBusy(false);
    }
  }, [suiteId, suiteStatus]);

  useEffect(() => { void load(); }, [load]);

  function toggle(candidate: Candidate) {
    if (!candidate.eligible) return;
    const key = keyFor(candidate);
    setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  }

  function selectAllEligible() {
    setSelected(eligible.map(keyFor));
  }

  async function importSelected() {
    if (!selected.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const candidates = selected.map(key => {
        const [sourceAnswerSheetId, ...questionParts] = key.split(":");
        return { sourceAnswerSheetId, questionKey: questionParts.join(":") };
      });
      const json = await fetch(`${API}/ai-examiner/benchmark-suites/${suiteId}/cases/bulk-import`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ candidates }),
      }).then(responseBody);
      setNotice(`${json.data.imported} verified human-gold case${json.data.imported === 1 ? "" : "s"} imported.`);
      setSelected([]);
      await onChanged();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to import benchmark candidates");
    } finally {
      setBusy(false);
    }
  }

  if (suiteStatus !== "DRAFT") return null;

  return <div className="rounded-xl border p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><Database size={18} className="text-brand-700"/><h3 className="font-bold">Benchmark Dataset Builder</h3></div>
        <p className="mt-1 text-xs text-slate-500">Scans finalized, teacher-approved answer sheets across this suite's branch and subject. Duplicate source content is excluded automatically.</p>
      </div>
      <button type="button" className="btn" disabled={busy} onClick={()=>void load()}>{busy?<Loader2 size={16} className="animate-spin"/>:<RefreshCw size={16}/>}Scan verified sources</button>
    </div>

    <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
      <b>{activeCaseCount}/{minimumCases}</b> cases currently in the suite · <b>{remaining}</b> more required before activation.
      Human gold marks imported here come from finalized teacher-approved question marks; the browser cannot edit them during bulk import.
    </div>

    {notice&&<p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    {error&&<p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    {pool&&<>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Finalized sources" value={pool.finalizedSourceCount}/>
        <Stat label="Independent sources" value={pool.independentSourceCount}/>
        <Stat label="Duplicate sources" value={pool.duplicateSourceCount}/>
        <Stat label="Eligible cases" value={pool.eligibleCaseCount}/>
        <Stat label="No approved AI review" value={pool.noApprovedEvaluationSources}/>
        <Stat label="No final question marks" value={pool.noFinalQuestionMarksSources}/>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={!eligible.length||busy} onClick={selectAllEligible}>Select all eligible</button>
        <button type="button" className="btn bg-brand-700 text-white disabled:opacity-40" disabled={!selected.length||busy} onClick={()=>void importSelected()}>
          {busy?<Loader2 size={16} className="animate-spin"/>:<ShieldCheck size={16}/>}Import {selected.length || ""} verified case{selected.length===1?"":"s"}
        </button>
      </div>

      <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
        {pool.candidates.map(candidate=>{
          const key=keyFor(candidate);
          const reason = candidate.alreadyAdded
            ? "Already in this suite"
            : candidate.duplicateSourceContent
              ? "Duplicate answer-sheet content"
              : "Eligible";
          return <label key={key} className={`grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[28px_1.4fr_90px_90px_1fr] ${candidate.eligible?"bg-white":"bg-slate-50 text-slate-500"}`}>
            <input type="checkbox" disabled={!candidate.eligible||busy} checked={selectedSet.has(key)} onChange={()=>toggle(candidate)} className="mt-1"/>
            <span>
              <b>{candidate.questionKey} · {candidate.student.name}</b>
              <small className="block text-slate-500">{candidate.examination.name} · {candidate.fileName}</small>
              <small className="block text-slate-400">Fingerprint {candidate.contentFingerprint}</small>
            </span>
            <span><small className="block text-slate-400">Max</small>{candidate.maxMarks}</span>
            <span><small className="block text-slate-400">Human gold</small>{candidate.humanMarks}</span>
            <span><small className="block text-slate-400">Source</small>{reason}<small className="block text-slate-400">AI provenance: {candidate.engineVersion} · {candidate.model??"model n/a"}</small></span>
          </label>;
        })}
        {!pool.candidates.length&&<p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No finalized, teacher-approved question-level candidates were found for this branch and subject.</p>}
      </div>

      {pool.duplicateSourceCount>0&&<p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Duplicate answer-sheet content was detected and excluded from eligibility so repeated files cannot inflate benchmark size.</p>}
    </>}
  </div>;
}

function Stat({label,value}:{label:string;value:number}) {
  return <div className="rounded-lg bg-slate-50 p-3"><span className="block text-slate-400">{label}</span><b className="mt-1 block text-base text-slate-800">{value}</b></div>;
}
