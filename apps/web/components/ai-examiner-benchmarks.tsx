"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, FlaskConical, Loader2, Plus, Play, RefreshCw } from "lucide-react";
import { getAccessToken } from "./auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });

type ExamContext = {
  id: string;
  name: string;
  code: string;
  subject: { id: string; name: string; code?: string | null };
  branch: { id: string; branchName: string };
};

type ReadinessContext = {
  activeRubric?: { rubric?: { questions?: Array<{ key: string; maxMarks: number }> } } | null;
  answerSheetItems?: Array<{
    id: string;
    fileName: string;
    finalizedAt: string | null;
    marksObtained: number | string | null;
    student: { name: string; admissionNo?: string | null; rollNo?: string | null };
    latestEvaluation?: { status: string } | null;
  }>;
};

type Thresholds = {
  minimumCases: number;
  agreementToleranceMarks: number;
  agreementToleranceRatio: number;
  maximumNormalizedMae: number;
  minimumWithinToleranceRate: number;
  maximumOverrideRate: number;
  maximumLowConfidenceRate: number;
  lowConfidenceThreshold: number;
};

type Suite = {
  id: string;
  branchId: string | null;
  subjectId: string | null;
  code: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  thresholds: Thresholds;
  approvedAt: string | null;
  _count: { cases: number; runs: number };
  subject?: { id: string; name: string; code?: string | null } | null;
  branch?: { id: string; branchName: string } | null;
};

type BenchmarkCase = {
  id: string;
  sourceAnswerSheetId: string | null;
  questionKey: string;
  maxMarks: number | string;
  minimumMarks: number | string;
  humanMarks: number | string;
  goldNotes: string | null;
  isActive: boolean;
  humanReviewer: { id: string; name: string };
  sourceAnswerSheet: {
    id: string;
    fileName: string;
    finalizedAt: string | null;
    marksObtained: number | string | null;
    student: { id: string; admissionNo: string; rollNo: string; user: { name: string } };
    examination: { id: string; name: string; code: string };
  } | null;
};

type BenchmarkRun = {
  id: string;
  engineVersion: string;
  provider: string | null;
  model: string | null;
  status: string;
  metrics: Record<string, any> | null;
  benchmarkReady: boolean;
  completedAt: string | null;
  createdAt: string;
  _count: { results: number };
};

const DEFAULT_THRESHOLDS: Thresholds = {
  minimumCases: 20,
  agreementToleranceMarks: 0.5,
  agreementToleranceRatio: 0.05,
  maximumNormalizedMae: 0.1,
  minimumWithinToleranceRate: 0.85,
  maximumOverrideRate: 0.2,
  maximumLowConfidenceRate: 0.25,
  lowConfidenceThreshold: 0.75,
};

async function responseBody(response: Response) {
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function AIExaminerBenchmarkPanel({ exam, readiness }: { exam: ExamContext; readiness: ReadinessContext }) {
  const [suites, setSuites] = useState<Suite[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [cases, setCases] = useState<BenchmarkCase[]>([]);
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [suiteForm, setSuiteForm] = useState({
    code: "",
    name: "",
    thresholds: { ...DEFAULT_THRESHOLDS },
  });
  const [caseForm, setCaseForm] = useState({
    sourceAnswerSheetId: "",
    questionKey: "",
    maxMarks: "",
    minimumMarks: "0",
    humanMarks: "",
    goldNotes: "",
  });

  const matchingSuites = useMemo(
    () => suites.filter(suite =>
      (!suite.branchId || suite.branchId === exam.branch.id) &&
      (!suite.subjectId || suite.subjectId === exam.subject.id)
    ),
    [suites, exam.branch.id, exam.subject.id],
  );
  const selectedSuite = matchingSuites.find(suite => suite.id === selectedSuiteId) ?? matchingSuites[0] ?? null;
  const finalizedSheets = useMemo(
    () => (readiness.answerSheetItems ?? []).filter(sheet => Boolean(sheet.finalizedAt)),
    [readiness.answerSheetItems],
  );
  const rubricQuestions = readiness.activeRubric?.rubric?.questions ?? [];

  const loadSuites = useCallback(async () => {
    const json = await fetch(`${API}/ai-examiner/benchmark-suites`, { headers: headers() }).then(responseBody);
    const rows = (json.data ?? []) as Suite[];
    setSuites(rows);
    setSelectedSuiteId(current => {
      const visible = rows.filter(suite =>
        (!suite.branchId || suite.branchId === exam.branch.id) &&
        (!suite.subjectId || suite.subjectId === exam.subject.id)
      );
      return visible.some(suite => suite.id === current) ? current : visible[0]?.id ?? "";
    });
  }, [exam.branch.id, exam.subject.id]);

  const loadSuiteDetails = useCallback(async (suiteId: string) => {
    if (!suiteId) {
      setCases([]);
      setRuns([]);
      return;
    }
    const [caseJson, runJson] = await Promise.all([
      fetch(`${API}/ai-examiner/benchmark-suites/${suiteId}/cases`, { headers: headers() }).then(responseBody),
      fetch(`${API}/ai-examiner/benchmark-suites/${suiteId}/runs`, { headers: headers() }).then(responseBody),
    ]);
    setCases(caseJson.data ?? []);
    setRuns(runJson.data ?? []);
  }, []);

  useEffect(() => {
    setSuiteForm({
      code: `${(exam.subject.code || exam.subject.name).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase()}-BENCHMARK`,
      name: `${exam.subject.name} release benchmark`,
      thresholds: { ...DEFAULT_THRESHOLDS },
    });
    setNotice("");
    setError("");
    void loadSuites().catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load benchmark suites"));
  }, [exam.id, exam.subject.code, exam.subject.name, loadSuites]);

  useEffect(() => {
    if (!selectedSuite?.id) return;
    setSelectedSuiteId(selectedSuite.id);
    void loadSuiteDetails(selectedSuite.id).catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load benchmark details"));
  }, [selectedSuite?.id, loadSuiteDetails]);

  function setThreshold<K extends keyof Thresholds>(key: K, value: string) {
    setSuiteForm(current => ({
      ...current,
      thresholds: { ...current.thresholds, [key]: safeNumber(value) },
    }));
  }

  async function createSuite() {
    if (!suiteForm.code.trim() || !suiteForm.name.trim()) {
      setError("Benchmark code and name are required.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const json = await fetch(`${API}/ai-examiner/benchmark-suites`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          branchId: exam.branch.id,
          subjectId: exam.subject.id,
          code: suiteForm.code.trim().toUpperCase(),
          name: suiteForm.name.trim(),
          thresholds: suiteForm.thresholds,
        }),
      }).then(responseBody);
      setNotice("Benchmark suite created as DRAFT. Add human-marked gold cases before activation.");
      await loadSuites();
      setSelectedSuiteId(json.data.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create benchmark suite");
    } finally {
      setBusy(false);
    }
  }

  async function addGoldCase() {
    if (!selectedSuite) return;
    if (!caseForm.sourceAnswerSheetId || !caseForm.questionKey.trim() || !caseForm.maxMarks || !caseForm.humanMarks) {
      setError("Source answer sheet, question key, max marks and human marks are required.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      await fetch(`${API}/ai-examiner/benchmark-suites/${selectedSuite.id}/cases`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          sourceAnswerSheetId: caseForm.sourceAnswerSheetId,
          questionKey: caseForm.questionKey.trim(),
          maxMarks: Number(caseForm.maxMarks),
          minimumMarks: Number(caseForm.minimumMarks || 0),
          humanMarks: Number(caseForm.humanMarks),
          goldNotes: caseForm.goldNotes.trim() || undefined,
          metadata: { source: "benchmark-management-ui", examinationId: exam.id },
        }),
      }).then(responseBody);
      setNotice("Human-marked gold case added.");
      setCaseForm({ sourceAnswerSheetId: "", questionKey: "", maxMarks: "", minimumMarks: "0", humanMarks: "", goldNotes: "" });
      await Promise.all([loadSuites(), loadSuiteDetails(selectedSuite.id)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add benchmark case");
    } finally {
      setBusy(false);
    }
  }

  async function activateSuite() {
    if (!selectedSuite) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await fetch(`${API}/ai-examiner/benchmark-suites/${selectedSuite.id}/activate`, {
        method: "POST",
        headers: headers(),
      }).then(responseBody);
      setNotice("Benchmark suite activated. Gold cases are now immutable for this suite.");
      await Promise.all([loadSuites(), loadSuiteDetails(selectedSuite.id)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to activate benchmark suite");
    } finally {
      setBusy(false);
    }
  }

  async function runFromApprovedEvaluations() {
    if (!selectedSuite) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const candidateJson = await fetch(
        `${API}/ai-examiner/benchmark-suites/${selectedSuite.id}/evaluation-results`,
        { headers: headers() },
      ).then(responseBody);
      const candidate = candidateJson.data;
      if (!candidate.readyForRun) {
        const missing = (candidate.missing ?? []).map((item: { reason: string }) => item.reason).join("; ");
        const mixed = candidate.mixedExecutionContexts?.length ? "Approved cases use mixed AI engine/provider/model contexts." : "";
        throw new Error([missing, mixed].filter(Boolean).join(" ") || "Benchmark candidate results are not ready.");
      }
      const runJson = await fetch(`${API}/ai-examiner/benchmark-suites/${selectedSuite.id}/runs`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          engineVersion: candidate.engineVersion,
          provider: candidate.provider,
          model: candidate.model,
          results: candidate.results,
        }),
      }).then(responseBody);
      setNotice(runJson.data.benchmarkReady
        ? "Benchmark run passed the configured release thresholds."
        : "Benchmark run completed but did not pass all configured thresholds.");
      await Promise.all([loadSuites(), loadSuiteDetails(selectedSuite.id)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to run benchmark");
    } finally {
      setBusy(false);
    }
  }

  const minimumCases = safeNumber(selectedSuite?.thresholds?.minimumCases, 0);
  const activeCaseCount = cases.filter(item => item.isActive).length;
  const latestRun = runs[0] ?? null;
  const overall = latestRun?.metrics?.overall as Record<string, unknown> | undefined;

  return <section className="mt-5 rounded-2xl border bg-white p-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex items-center gap-2"><FlaskConical className="text-brand-700" size={21}/><h2 className="text-xl font-bold">Benchmark Management</h2></div>
        <p className="mt-1 text-sm text-slate-500">Build human-gold calibration suites, run the current AI engine against approved evaluations, and gate release readiness on measured accuracy.</p>
      </div>
      <button type="button" onClick={() => void Promise.all([loadSuites(), selectedSuite?.id ? loadSuiteDetails(selectedSuite.id) : Promise.resolve()])} className="btn">
        <RefreshCw size={16}/>Refresh
      </button>
    </div>

    <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
      A benchmark passing here is evidence for AI-grading certification only. It does not certify physical devices or authorize a production deployment.
    </div>
    {notice&&<p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    {error&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    <div className="mt-5 grid gap-5 xl:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <div className="rounded-xl border p-4">
          <h3 className="font-bold">Create benchmark suite</h3>
          <p className="mt-1 text-xs text-slate-500">{exam.branch.branchName} · {exam.subject.name}</p>
          <div className="mt-3 space-y-3">
            <label className="text-sm font-semibold">Suite code<input className="field mt-1" value={suiteForm.code} onChange={event=>setSuiteForm(current=>({...current,code:event.target.value}))}/></label>
            <label className="text-sm font-semibold">Name<input className="field mt-1" value={suiteForm.name} onChange={event=>setSuiteForm(current=>({...current,name:event.target.value}))}/></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold">Minimum cases<input className="field mt-1" type="number" min="1" value={suiteForm.thresholds.minimumCases} onChange={event=>setThreshold("minimumCases",event.target.value)}/></label>
              <label className="text-xs font-semibold">Tolerance marks<input className="field mt-1" type="number" min="0" step="0.1" value={suiteForm.thresholds.agreementToleranceMarks} onChange={event=>setThreshold("agreementToleranceMarks",event.target.value)}/></label>
              <label className="text-xs font-semibold">Tolerance ratio<input className="field mt-1" type="number" min="0" max="1" step="0.01" value={suiteForm.thresholds.agreementToleranceRatio} onChange={event=>setThreshold("agreementToleranceRatio",event.target.value)}/></label>
              <label className="text-xs font-semibold">Max normalized MAE<input className="field mt-1" type="number" min="0" max="1" step="0.01" value={suiteForm.thresholds.maximumNormalizedMae} onChange={event=>setThreshold("maximumNormalizedMae",event.target.value)}/></label>
              <label className="text-xs font-semibold">Min within tolerance<input className="field mt-1" type="number" min="0" max="1" step="0.01" value={suiteForm.thresholds.minimumWithinToleranceRate} onChange={event=>setThreshold("minimumWithinToleranceRate",event.target.value)}/></label>
              <label className="text-xs font-semibold">Max override rate<input className="field mt-1" type="number" min="0" max="1" step="0.01" value={suiteForm.thresholds.maximumOverrideRate} onChange={event=>setThreshold("maximumOverrideRate",event.target.value)}/></label>
              <label className="text-xs font-semibold">Max low confidence<input className="field mt-1" type="number" min="0" max="1" step="0.01" value={suiteForm.thresholds.maximumLowConfidenceRate} onChange={event=>setThreshold("maximumLowConfidenceRate",event.target.value)}/></label>
              <label className="text-xs font-semibold">Low confidence cutoff<input className="field mt-1" type="number" min="0" max="1" step="0.01" value={suiteForm.thresholds.lowConfidenceThreshold} onChange={event=>setThreshold("lowConfidenceThreshold",event.target.value)}/></label>
            </div>
            <button type="button" disabled={busy} onClick={()=>void createSuite()} className="btn w-full bg-brand-700 text-white disabled:opacity-50"><Plus size={16}/>Create Draft Suite</button>
          </div>
        </div>

        <div className="rounded-xl border p-4">
          <h3 className="font-bold">Existing suites</h3>
          {matchingSuites.length?<select className="field mt-3" value={selectedSuite?.id??""} onChange={event=>setSelectedSuiteId(event.target.value)}>
            {matchingSuites.map(suite=><option key={suite.id} value={suite.id}>{suite.code} · {suite.status}</option>)}
          </select>:<p className="mt-3 text-sm text-slate-500">No benchmark suite exists for this branch/subject yet.</p>}
          {selectedSuite&&<div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
            <b>{selectedSuite.name}</b>
            <div className="mt-1 text-xs text-slate-500">Status {selectedSuite.status} · {activeCaseCount}/{minimumCases} active cases · {runs.length} runs</div>
          </div>}
        </div>
      </div>

      <div className="space-y-4">
        {selectedSuite?.status==="DRAFT"&&<div className="rounded-xl border p-4">
          <h3 className="font-bold">Add human-gold case</h3>
          <p className="mt-1 text-xs text-slate-500">Use only finalized answer sheets and human-verified question marks.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold">Finalized answer sheet<select className="field mt-1" value={caseForm.sourceAnswerSheetId} onChange={event=>setCaseForm(current=>({...current,sourceAnswerSheetId:event.target.value}))}>
              <option value="">Select answer sheet</option>
              {finalizedSheets.map(sheet=><option key={sheet.id} value={sheet.id}>{sheet.student.name} · {sheet.fileName}</option>)}
            </select></label>
            <label className="text-sm font-semibold">Question<select className="field mt-1" value={caseForm.questionKey} onChange={event=>{
              const key=event.target.value;
              const question=rubricQuestions.find(item=>item.key===key);
              setCaseForm(current=>({...current,questionKey:key,maxMarks:question?String(question.maxMarks):current.maxMarks}));
            }}>
              <option value="">Select question</option>
              {rubricQuestions.map(question=><option key={question.key} value={question.key}>{question.key} · {question.maxMarks} marks</option>)}
            </select></label>
            <label className="text-sm font-semibold">Max marks<input className="field mt-1" type="number" step="0.25" value={caseForm.maxMarks} onChange={event=>setCaseForm(current=>({...current,maxMarks:event.target.value}))}/></label>
            <label className="text-sm font-semibold">Human gold marks<input className="field mt-1" type="number" step="0.25" value={caseForm.humanMarks} onChange={event=>setCaseForm(current=>({...current,humanMarks:event.target.value}))}/></label>
            <label className="text-sm font-semibold">Minimum marks<input className="field mt-1" type="number" step="0.25" value={caseForm.minimumMarks} onChange={event=>setCaseForm(current=>({...current,minimumMarks:event.target.value}))}/></label>
            <label className="text-sm font-semibold">Gold notes<input className="field mt-1" value={caseForm.goldNotes} onChange={event=>setCaseForm(current=>({...current,goldNotes:event.target.value}))} placeholder="Human-marked reference / rationale"/></label>
          </div>
          {!finalizedSheets.length&&<p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No finalized answer sheets are available in the selected assessment.</p>}
          <button type="button" disabled={busy||!finalizedSheets.length} onClick={()=>void addGoldCase()} className="btn mt-3 bg-brand-700 text-white disabled:opacity-50"><Plus size={16}/>Add Gold Case</button>
        </div>}

        {selectedSuite&&<div className="rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-bold">Gold dataset</h3><p className="text-xs text-slate-500">{activeCaseCount} active cases; activation threshold {minimumCases}</p></div>
            {selectedSuite.status==="DRAFT"&&<button type="button" disabled={busy||activeCaseCount<minimumCases} onClick={()=>void activateSuite()} className="btn border-emerald-200 text-emerald-700 disabled:opacity-40"><CheckCircle2 size={16}/>Activate Suite</button>}
          </div>
          <div className="mt-3 space-y-2">
            {cases.map(item=><div key={item.id} className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm md:grid-cols-[1fr_90px_90px_100px]">
              <span><b>{item.questionKey}</b> · {item.sourceAnswerSheet?.student.user.name??"Unknown student"}<small className="block text-slate-500">{item.sourceAnswerSheet?.examination.name??"No source examination"} · reviewer {item.humanReviewer.name}</small></span>
              <span><small className="block text-slate-400">Max</small>{Number(item.maxMarks)}</span>
              <span><small className="block text-slate-400">Human</small>{Number(item.humanMarks)}</span>
              <span><small className="block text-slate-400">State</small>{item.isActive?"ACTIVE":"INACTIVE"}</span>
            </div>)}
            {!cases.length&&<p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No benchmark cases added yet.</p>}
          </div>
        </div>}

        {selectedSuite?.status==="ACTIVE"&&<div className="rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="font-bold">Calibration runs</h3><p className="mt-1 text-xs text-slate-500">Uses AI suggested marks from the latest approved evaluation for each gold case; teacher final marks remain the independent reference.</p></div>
            <button type="button" disabled={busy||!cases.length} onClick={()=>void runFromApprovedEvaluations()} className="btn bg-brand-700 text-white disabled:opacity-50">{busy?<Loader2 size={16} className="animate-spin"/>:<Play size={16}/>}Run Current Engine</button>
          </div>
          {latestRun&&<div className={`mt-3 rounded-xl p-4 ${latestRun.benchmarkReady?"bg-emerald-50 text-emerald-900":"bg-amber-50 text-amber-900"}`}>
            <div className="flex items-center gap-2"><Activity size={17}/><b>{latestRun.benchmarkReady?"Benchmark ready":"Thresholds not met"}</b></div>
            <p className="mt-1 text-sm">Run ID <code>{latestRun.id}</code> · Engine {latestRun.engineVersion} · {latestRun._count.results} cases</p>
            {overall&&<div className="mt-2 grid gap-2 text-xs sm:grid-cols-4">
              <span>Normalized MAE <b>{safeNumber(overall.normalizedMae).toFixed(3)}</b></span>
              <span>Within tolerance <b>{(safeNumber(overall.withinToleranceRate)*100).toFixed(1)}%</b></span>
              <span>Override rate <b>{(safeNumber(overall.overrideRate)*100).toFixed(1)}%</b></span>
              <span>Low confidence <b>{(safeNumber(overall.lowConfidenceRate)*100).toFixed(1)}%</b></span>
            </div>}
          </div>}
          <div className="mt-3 space-y-2">
            {runs.slice(0,5).map(run=><div key={run.id} className="grid gap-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-[1fr_140px_110px]">
              <span><b>{run.engineVersion}</b><small className="block text-slate-500">{run.provider??"provider n/a"} · {run.model??"model n/a"}</small></span>
              <span>{run.completedAt?new Date(run.completedAt).toLocaleString():"Not completed"}</span>
              <span className={run.benchmarkReady?"font-bold text-emerald-700":"font-bold text-amber-700"}>{run.benchmarkReady?"READY":"NOT READY"}</span>
            </div>)}
            {!runs.length&&<p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No benchmark runs recorded yet.</p>}
          </div>
        </div>}
      </div>
    </div>
  </section>;
}
