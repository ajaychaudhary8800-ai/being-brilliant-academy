"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrainCircuit, CheckCircle2, Loader2, Play, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { getAccessToken } from "./auth-provider";
import { AIExaminerBenchmarkPanel } from "./ai-examiner-benchmarks";
import Sidebar from "./sidebar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });

const QUESTION_TYPES = [
  ["MCQ","MCQ"],["MSQ","MSQ / multiple correct"],["TRUE_FALSE","True / False"],["ASSERTION_REASON","Assertion–Reason"],
  ["FILL_BLANK","Fill in the blank"],["MATCHING","Matching"],["ONE_WORD","One-word answer"],["NUMERICAL","Numerical answer"],
  ["SHORT_ANSWER","Short answer"],["LONG_ANSWER","Long answer"],["CASE_STUDY","Case study"],["DERIVATION","Derivation"],
  ["PROOF","Proof"],["CALCULATION","Calculation"],["DIAGRAM","Diagram"],["GRAPH","Graph"],["MAP","Map"],
  ["GEOMETRY_CONSTRUCTION","Geometry construction"],["CHEMISTRY_EQUATION","Chemistry equation / reaction"],
  ["ACCOUNTING_STATEMENT","Accounting ledger / statement"],["PROGRAMMING","Programming"],["ESSAY","Essay"],
  ["LANGUAGE","Language answer"],["ORAL_AUDIO_VIDEO","Oral / audio / video"],["PRACTICAL_PROJECT_VIVA","Practical / project / viva"],
  ["EARLY_YEARS_VISUAL","Early-years visual / tracing"],
] as const;
type QuestionType = typeof QUESTION_TYPES[number][0];
type AnswerKeyValue = string|number|boolean|Array<string|number|boolean>|Record<string,string|number|boolean>;
const DETERMINISTIC_TYPES = new Set<QuestionType>(["MCQ","MSQ","TRUE_FALSE","ASSERTION_REASON","FILL_BLANK","MATCHING","ONE_WORD","NUMERICAL"]);

type Exam = {
  id:string; name:string; code:string; status:string; maximumMarks:number; examDate:string;
  subject:{id:string;name:string;code:string|null}; batch:{id:string;name:string}; branch:{id:string;branchName:string};
  questionPaper:{id:string;publishedAt:string|null}|null;
  aiExaminerRubrics:{id:string;version:number;status:string}[];
  _count:{answerSheets:number};
};
type RawRubric = {
  id:string; version:number; status:string; instructions:string|null;
  rubric:{questions?:Array<{
    key:string;maxMarks:number;criteria:string;concepts?:string[];questionType?:QuestionType;answerKey?:AnswerKeyValue;
    scoring?:{correctMarks?:number;incorrectMarks?:number;unansweredMarks?:number;partialMode?:string;numericalTolerance?:{absolute?:number;relative?:number}};
    requiresVisualEvidence?:boolean;requiresCodeExecution?:boolean;
  }>};
  modelAnswer:{questions?:Array<{key:string;answer:string}>}|null;
};
type Readiness = {
  examination:{id:string;name:string;code:string;status:string;maximumMarks:number;subject:{name:string};batch:{name:string};branch:{branchName:string};teacher:{name:string}};
  questionPaper:{id:string;fileName:string;publishedAt:string|null}|null;
  activeRubric:RawRubric|null;
  draftRubric:RawRubric|null;
  answerSheets:{total:number;withAIEvaluation:number};
  setupReady:boolean;
  blockers:string[];
  engine:{providerConfigured:boolean;providerMode:string;model:string;engineVersion:string;reviewThreshold:number;evaluationExecutionAvailable:boolean;phase:string};
  answerSheetItems:Array<{
    id:string;fileName:string;mimeType:string;status:string;isLate:boolean;submittedAt:string;finalizedAt:string|null;marksObtained:number|string|null;
    student:{id:string;admissionNo:string|null;rollNo:string|null;name:string};
    latestEvaluation:{id:string;revision:number;status:string;suggestedMarks:number|string|null;confidence:number|string|null;errorCode:string|null;errorMessage:string|null;createdAt:string;completedAt:string|null}|null;
  }>;
};
type QuestionDraft = {
  key:string;maxMarks:string;criteria:string;modelAnswer:string;concepts:string;questionType:QuestionType;answerKey:string;
  correctMarks:string;incorrectMarks:string;unansweredMarks:string;partialMode:"NONE"|"PROPORTIONAL_NO_WRONG"|"PROPORTIONAL_WITH_PENALTY";
  absoluteTolerance:string;relativeTolerance:string;requiresVisualEvidence:boolean;
};

function emptyQuestion(key:string):QuestionDraft {
  return {key,maxMarks:"",criteria:"",modelAnswer:"",concepts:"",questionType:"LONG_ANSWER",answerKey:"",correctMarks:"",incorrectMarks:"",unansweredMarks:"",partialMode:"NONE",absoluteTolerance:"",relativeTolerance:"",requiresVisualEvidence:false};
}
function displayAnswerKey(value:AnswerKeyValue|undefined){
  if(value==null)return "";
  if(Array.isArray(value))return value.map(String).join(", ");
  if(typeof value==="object")return Object.entries(value).map(([key,item])=>`${key}=${String(item)}`).join(", ");
  return String(value);
}
function answerKeyPayload(question:QuestionDraft):AnswerKeyValue|undefined {
  const raw=question.answerKey.trim();
  if(!DETERMINISTIC_TYPES.has(question.questionType))return undefined;
  if(question.questionType==="MSQ"){
    const values=raw.split(/[,;\n]+/).map(value=>value.trim()).filter(Boolean);
    if(!values.length)throw new Error(`${question.key||"Question"}: enter the MSQ correct options, for example A, C.`);
    return values;
  }
  if(question.questionType==="MATCHING"){
    const pairs=raw.split(/[,;\n]+/).map(value=>value.trim()).filter(Boolean);
    if(!pairs.length)throw new Error(`${question.key||"Question"}: enter matching pairs, for example A=1, B=2.`);
    const result:Record<string,string>={};
    for(const pair of pairs){
      const match=pair.match(/^(.+?)(?:=|->)(.+)$/);
      if(!match?.[1]?.trim()||!match?.[2]?.trim())throw new Error(`${question.key||"Question"}: invalid matching pair "${pair}". Use A=1 format.`);
      result[match[1].trim()]=match[2].trim();
    }
    return result;
  }
  if(!raw){
    if(question.modelAnswer.trim())return undefined;
    throw new Error(`${question.key||"Question"}: enter an answer key or model answer for deterministic scoring.`);
  }
  return raw;
}
function optionalNumber(value:string){return value.trim()===""?undefined:Number(value);}

async function responseBody(response:Response) {
  const json=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(json?.error?.message??"Request failed");
  return json;
}

function rubricQuestions(source:RawRubric|null):QuestionDraft[] {
  const answers=new Map((source?.modelAnswer?.questions??[]).map(item=>[item.key,item.answer]));
  const questions=source?.rubric?.questions??[];
  if(!questions.length)return [emptyQuestion("Q1")];
  return questions.map(item=>({
    ...emptyQuestion(item.key),
    key:item.key,maxMarks:String(item.maxMarks),criteria:item.criteria,modelAnswer:answers.get(item.key)??"",concepts:(item.concepts??[]).join(", "),
    questionType:item.questionType??"LONG_ANSWER",answerKey:displayAnswerKey(item.answerKey),
    correctMarks:item.scoring?.correctMarks==null?"":String(item.scoring.correctMarks),
    incorrectMarks:item.scoring?.incorrectMarks==null?"":String(item.scoring.incorrectMarks),
    unansweredMarks:item.scoring?.unansweredMarks==null?"":String(item.scoring.unansweredMarks),
    partialMode:(item.scoring?.partialMode==="PROPORTIONAL_NO_WRONG"||item.scoring?.partialMode==="PROPORTIONAL_WITH_PENALTY"?item.scoring.partialMode:"NONE"),
    absoluteTolerance:item.scoring?.numericalTolerance?.absolute==null?"":String(item.scoring.numericalTolerance.absolute),
    relativeTolerance:item.scoring?.numericalTolerance?.relative==null?"":String(item.scoring.numericalTolerance.relative),
    requiresVisualEvidence:Boolean(item.requiresVisualEvidence),
  }));
}

export function AIExaminerFoundationContent({teacherView=false}:{teacherView?:boolean}) {
  const [exams,setExams]=useState<Exam[]>([]);
  const [selected,setSelected]=useState("");
  const [readiness,setReadiness]=useState<Readiness|null>(null);
  const [instructions,setInstructions]=useState("");
  const [questions,setQuestions]=useState<QuestionDraft[]>([emptyQuestion("Q1")]);
  const [busy,setBusy]=useState(true);
  const [saving,setSaving]=useState(false);
  const [starting,setStarting]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  const loadExams=useCallback(async()=>{
    setBusy(true);
    try{
      const json=await fetch(`${API}/ai-examiner/examinations`,{headers:headers()}).then(responseBody);
      setExams(json.data??[]);
      setSelected(current=>current||json.data?.[0]?.id||"");
      setError("");
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to load AI Examiner assessments");}
    finally{setBusy(false);}
  },[]);

  const loadReadiness=useCallback(async()=>{
    if(!selected){setReadiness(null);return;}
    try{
      const json=await fetch(`${API}/ai-examiner/examinations/${selected}/readiness`,{headers:headers()}).then(responseBody);
      const data=json.data as Readiness;
      setReadiness(data);
      const source=data.draftRubric??data.activeRubric;
      setInstructions(source?.instructions??"");
      setQuestions(rubricQuestions(source));
      setError("");
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to load AI Examiner readiness");}
  },[selected]);

  useEffect(()=>{void loadExams();},[loadExams]);
  useEffect(()=>{void loadReadiness();},[loadReadiness]);
  useEffect(()=>{
    if(!readiness?.answerSheetItems?.some(sheet=>["QUEUED","PROCESSING"].includes(sheet.latestEvaluation?.status??""))) return;
    const timer=window.setInterval(()=>void loadReadiness(),3000);
    return()=>window.clearInterval(timer);
  },[readiness?.answerSheetItems,loadReadiness]);


  const selectedExam=useMemo(()=>exams.find(exam=>exam.id===selected)??null,[exams,selected]);
  const totalMarks=useMemo(()=>questions.reduce((sum,item)=>sum+(Number(item.maxMarks)||0),0),[questions]);
  const maximum=readiness?.examination.maximumMarks??0;
  const marksMatch=Math.abs(totalMarks-maximum)<0.001;

  function updateQuestion<K extends keyof QuestionDraft>(index:number,field:K,value:QuestionDraft[K]){setQuestions(items=>items.map((item,i)=>i===index?{...item,[field]:value}:item));}
  const addQuestion=()=>setQuestions(items=>[...items,emptyQuestion(`Q${items.length+1}`)]);
  const removeQuestion=(index:number)=>setQuestions(items=>items.length===1?items:items.filter((_,i)=>i!==index));

  async function startEvaluation(answerSheetId:string){
    setStarting(answerSheetId);setError("");setNotice("");
    try{
      const json=await fetch(`${API}/ai-examiner/answer-sheets/${answerSheetId}/evaluate`,{method:"POST",headers:headers()}).then(responseBody);
      setNotice(`AI evaluation revision ${json.data.revision} queued. This page will refresh automatically.`);
      await loadReadiness();
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to start AI evaluation");}
    finally{setStarting("");}
  }

  async function saveRubric(){
    if(!selected)return;
    setSaving(true);setError("");setNotice("");
    try{
      const payload={instructions:instructions||null,questions:questions.map(item=>{
        const answerKey=answerKeyPayload(item);
        const scoring=DETERMINISTIC_TYPES.has(item.questionType)?{
          correctMarks:optionalNumber(item.correctMarks),
          incorrectMarks:optionalNumber(item.incorrectMarks),
          unansweredMarks:optionalNumber(item.unansweredMarks),
          partialMode:item.partialMode,
          ...(item.questionType==="NUMERICAL"?{numericalTolerance:{absolute:optionalNumber(item.absoluteTolerance)??0,relative:optionalNumber(item.relativeTolerance)??0}}:{}),
        }:undefined;
        return {
          key:item.key.trim(),
          maxMarks:Number(item.maxMarks),
          criteria:item.criteria.trim(),
          modelAnswer:item.modelAnswer.trim()||null,
          concepts:item.concepts.split(",").map(value=>value.trim()).filter(Boolean),
          questionType:item.questionType,
          answerKey,
          scoring,
          requiresVisualEvidence:item.requiresVisualEvidence,
          requiresCodeExecution:item.questionType==="PROGRAMMING",
        };
      })};
      await fetch(`${API}/ai-examiner/examinations/${selected}/rubric`,{method:"PUT",headers:headers(),body:JSON.stringify(payload)}).then(responseBody);
      setNotice("AI Examiner rubric draft saved.");
      await loadReadiness();
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to save rubric");}
    finally{setSaving(false);}
  }

  async function activateRubric(){
    if(!selected||!readiness?.draftRubric)return;
    if(!marksMatch){setError(`Rubric marks must total ${maximum} before activation.`);return;}
    setSaving(true);setError("");setNotice("");
    try{
      await fetch(`${API}/ai-examiner/examinations/${selected}/rubrics/${readiness.draftRubric.id}/activate`,{method:"POST",headers:headers()}).then(responseBody);
      setNotice("AI Examiner rubric activated.");
      await loadReadiness();
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to activate rubric");}
    finally{setSaving(false);}
  }

  return <div className="min-h-screen bg-slate-50">
    {!teacherView&&<Sidebar/>}
    <main className={`p-5 md:p-10 ${teacherView?"":"md:ml-64"}`}>
      <div className="mx-auto max-w-6xl">
        {teacherView&&<Link href="/teacher/examinations" className="mb-4 inline-block font-bold text-brand-700">← Examinations</Link>}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-sm font-bold text-brand-700">RANPAL AI EXAMINER</p><h1 className="text-3xl font-bold">AI Evaluation Setup</h1><p className="mt-1 text-slate-500">Question-wise routing, deterministic objective scoring, rubric evaluation and mandatory human-review controls.</p></div>
          <BrainCircuit className="text-brand-700" size={34}/>
        </header>
        {notice&&<p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">{notice}</p>}
        {error&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
        <section className="mt-6 rounded-2xl border bg-white p-5">
          <label className="font-semibold">Assessment
            <select className="field mt-2" value={selected} onChange={event=>setSelected(event.target.value)}>
              <option value="">Select assessment</option>
              {exams.map(exam=><option key={exam.id} value={exam.id}>{exam.name} — {exam.subject.name} — {exam.batch.name}</option>)}
            </select>
          </label>
        </section>
        {busy?<Loader2 className="mx-auto my-16 animate-spin"/>:readiness&&<>
          <section className="mt-5 grid gap-3 md:grid-cols-4">
            <StatusCard label="Question paper" ok={Boolean(readiness.questionPaper?.publishedAt)} value={readiness.questionPaper?.publishedAt?"Published":"Required"}/>
            <StatusCard label="Active rubric" ok={Boolean(readiness.activeRubric)} value={readiness.activeRubric?`Version ${readiness.activeRubric.version}`:"Required"}/>
            <StatusCard label="Answer sheets" ok={readiness.answerSheets.total>0} value={String(readiness.answerSheets.total)}/>
            <StatusCard label="AI evaluation window" ok={readiness.setupReady || readiness.examination.status === "RESULTS_PUBLISHED" || readiness.examination.status === "ARCHIVED"} value={readiness.setupReady ? "Ready" : readiness.examination.status === "RESULTS_PUBLISHED" || readiness.examination.status === "ARCHIVED" ? "Closed" : "Blocked"}/>
          </section>
          <section className="mt-5 rounded-2xl border bg-white p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div><h2 className="text-xl font-bold">{readiness.examination.name}</h2><p className="text-sm text-slate-500">{readiness.examination.subject.name} · {readiness.examination.batch.name} · Maximum {maximum} marks</p></div>
              <div className={`rounded-xl px-4 py-3 text-sm ${readiness.engine.providerConfigured&&readiness.engine.evaluationExecutionAvailable?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-900"}`}><b>AI execution:</b> {readiness.engine.providerConfigured&&readiness.engine.evaluationExecutionAvailable?"Ready":"Not ready"}<br/><span>{readiness.engine.providerConfigured?"AI provider configured":"AI provider not configured"} · {readiness.engine.evaluationExecutionAvailable?"evaluation runner enabled":"evaluation runner disabled"}</span></div>
            </div>
            {readiness.blockers.length>0&&<div className={`mt-4 rounded-xl p-4 text-sm ${readiness.examination.status==="RESULTS_PUBLISHED"||readiness.examination.status==="ARCHIVED"?"bg-slate-50 text-slate-700":"bg-amber-50 text-amber-900"}`}><b>{readiness.examination.status==="RESULTS_PUBLISHED"||readiness.examination.status==="ARCHIVED"?"Evaluation lifecycle":"Readiness blockers"}</b><ul className="mt-2 list-disc space-y-1 pl-5">{readiness.blockers.map(item=><li key={item}>{item}</li>)}</ul></div>}
          </section>
          <section className="mt-5 rounded-2xl border bg-white p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div><h2 className="text-xl font-bold">Answer Sheets & AI Evaluation</h2><p className="text-sm text-slate-500">AI suggests question-wise marks. A teacher or authorized manager must review every question before final marks are written.</p></div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Engine {readiness.engine.engineVersion}</div>
            </div>
            {!readiness.engine.evaluationExecutionAvailable&&<div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><b>AI execution is disabled.</b> Configure the AI provider on the API service before starting evaluations.</div>}
            <div className="mt-4 space-y-3">
              {readiness.answerSheetItems?.length?readiness.answerSheetItems.map(sheet=>{
                const evaluation=sheet.latestEvaluation;
                const running=evaluation&&["QUEUED","PROCESSING"].includes(evaluation.status);
                const review=evaluation?.status==="REVIEW_REQUIRED";
                const approved=evaluation?.status==="APPROVED";
                const failed=evaluation?.status==="FAILED";
                return <article key={sheet.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="font-bold">{sheet.student.name}</p>
                      <p className="text-sm text-slate-500">{sheet.student.admissionNo??"No admission number"} · {sheet.fileName}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">{sheet.status}</span>
                        {sheet.isLate&&<span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">Late submission</span>}
                        {evaluation&&<span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">AI r{evaluation.revision}: {evaluation.status}</span>}
                        {evaluation?.confidence!=null&&<span className="rounded-full bg-slate-100 px-2.5 py-1">Confidence {Math.round(Number(evaluation.confidence)*100)}%</span>}
                        {evaluation?.suggestedMarks!=null&&<span className="rounded-full bg-slate-100 px-2.5 py-1">Suggested {Number(evaluation.suggestedMarks)}/{maximum}</span>}
                      </div>
                      {failed&&<p className="mt-2 text-sm text-red-700">{evaluation.errorCode}: {evaluation.errorMessage}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {review&&<Link className="btn border-emerald-200 text-emerald-700" href={teacherView?`/teacher/ai-examiner/review/${evaluation.id}`:`/admin/ai-examiner/review/${evaluation.id}`}><Sparkles size={16}/>Review AI Marks</Link>}
                      {approved&&<Link className="btn" href={teacherView?`/teacher/ai-examiner/review/${evaluation.id}`:`/admin/ai-examiner/review/${evaluation.id}`}>View Approved Review</Link>}
                      {!review&&!approved&&!running&&!sheet.finalizedAt&&<button type="button" className="btn bg-brand-700 text-white disabled:opacity-40" disabled={!readiness.setupReady||!readiness.engine.evaluationExecutionAvailable||starting===sheet.id} onClick={()=>void startEvaluation(sheet.id)}>{starting===sheet.id?<Loader2 className="animate-spin" size={16}/>:<Play size={16}/>} {failed?"Retry AI Evaluation":"Start AI Evaluation"}</button>}
                      {running&&<span className="inline-flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800"><Loader2 className="animate-spin" size={16}/>{evaluation?.status==="QUEUED"?"Queued":"Evaluating"}</span>}
                      {sheet.finalizedAt&&<span className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Finalized</span>}
                    </div>
                  </div>
                </article>;
              }):<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No submitted answer sheets are available.</p>}
            </div>
          </section>
          {selectedExam&&<AIExaminerBenchmarkPanel exam={selectedExam} readiness={readiness}/>}
          <section className="mt-5 rounded-2xl border bg-white p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-bold">Marking Rubric</h2><p className="text-sm text-slate-500">Drafts are editable. Activating a new version preserves older rubrics for evaluation history.</p></div><div className={`rounded-full px-3 py-1 text-sm font-bold ${marksMatch?"bg-emerald-50 text-emerald-700":"bg-amber-50 text-amber-800"}`}>{totalMarks} / {maximum} marks</div></div>
            <label className="mt-4 block text-sm font-semibold">General evaluation instructions<textarea className="field mt-1.5 min-h-24" value={instructions} onChange={event=>setInstructions(event.target.value)} placeholder="Examples: award method marks, accept equivalent derivations, flag unclear diagrams for teacher review."/></label>
            <div className="mt-5 space-y-4">
              {questions.map((question,index)=>{
                const deterministic=DETERMINISTIC_TYPES.has(question.questionType);
                const routeLabel=deterministic?"Deterministic scoring after answer extraction":question.questionType==="PROGRAMMING"?"Sandbox / specialized review":question.requiresVisualEvidence||["DIAGRAM","GRAPH","MAP","GEOMETRY_CONSTRUCTION","ORAL_AUDIO_VIDEO","PRACTICAL_PROJECT_VIVA","EARLY_YEARS_VISUAL"].includes(question.questionType)?"Multimodal + teacher review":"Rubric-semantic + teacher review";
                return <article key={index} className="rounded-xl border p-4">
                  <div className="grid gap-3 md:grid-cols-[100px_120px_220px_1fr_auto]">
                    <label className="text-sm font-semibold">Question<input className="field mt-1" value={question.key} onChange={event=>updateQuestion(index,"key",event.target.value)}/></label>
                    <label className="text-sm font-semibold">Max marks<input className="field mt-1" type="number" min="0.5" step="0.5" value={question.maxMarks} onChange={event=>updateQuestion(index,"maxMarks",event.target.value)}/></label>
                    <label className="text-sm font-semibold">Question type<select className="field mt-1" value={question.questionType} onChange={event=>updateQuestion(index,"questionType",event.target.value as QuestionType)}>{QUESTION_TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="text-sm font-semibold">Concepts<input className="field mt-1" value={question.concepts} onChange={event=>updateQuestion(index,"concepts",event.target.value)} placeholder="Current electricity, Kirchhoff laws"/></label>
                    <button type="button" onClick={()=>removeQuestion(index)} disabled={questions.length===1} className="self-end rounded-lg border p-3 text-red-600 disabled:opacity-30" aria-label="Remove question"><Trash2 size={17}/></button>
                  </div>
                  <div className="mt-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{routeLabel}</span></div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-semibold">Marking criteria<textarea className="field mt-1 min-h-28" value={question.criteria} onChange={event=>updateQuestion(index,"criteria",event.target.value)} placeholder="Define step-wise marks and acceptable alternatives."/></label>
                    <label className="text-sm font-semibold">Model answer / solution<textarea className="field mt-1 min-h-28" value={question.modelAnswer} onChange={event=>updateQuestion(index,"modelAnswer",event.target.value)} placeholder="Reference solution, derivation, key points or acceptable alternatives."/></label>
                  </div>
                  {deterministic&&<div className="mt-3 rounded-xl bg-slate-50 p-4">
                    <p className="text-sm font-bold">Deterministic marking rule</p>
                    <p className="mt-1 text-xs text-slate-500">The AI model extracts the written response only. Ranpal AI applies this key and marking rule in code.</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      <label className="text-sm font-semibold md:col-span-2">Answer key<input className="field mt-1" value={question.answerKey} onChange={event=>updateQuestion(index,"answerKey",event.target.value)} placeholder={question.questionType==="MSQ"?"A, C, D":question.questionType==="MATCHING"?"A=1, B=2, C=3":"Correct answer"}/></label>
                      <label className="text-sm font-semibold">Correct marks<input className="field mt-1" type="number" step="0.25" value={question.correctMarks} onChange={event=>updateQuestion(index,"correctMarks",event.target.value)} placeholder={question.maxMarks||"Max"}/></label>
                      <label className="text-sm font-semibold">Incorrect marks<input className="field mt-1" type="number" step="0.25" value={question.incorrectMarks} onChange={event=>updateQuestion(index,"incorrectMarks",event.target.value)} placeholder="0 or -1"/></label>
                      <label className="text-sm font-semibold">Unanswered marks<input className="field mt-1" type="number" step="0.25" value={question.unansweredMarks} onChange={event=>updateQuestion(index,"unansweredMarks",event.target.value)} placeholder="0"/></label>
                      {(question.questionType==="MSQ"||question.questionType==="MATCHING")&&<label className="text-sm font-semibold md:col-span-2">Partial marking<select className="field mt-1" value={question.partialMode} onChange={event=>updateQuestion(index,"partialMode",event.target.value as QuestionDraft["partialMode"])}><option value="NONE">No partial marks</option><option value="PROPORTIONAL_NO_WRONG">Proportional only when no wrong option/pair</option><option value="PROPORTIONAL_WITH_PENALTY">Proportional with wrong-selection penalty</option></select></label>}
                      {question.questionType==="NUMERICAL"&&<>
                        <label className="text-sm font-semibold">Absolute tolerance<input className="field mt-1" type="number" min="0" step="any" value={question.absoluteTolerance} onChange={event=>updateQuestion(index,"absoluteTolerance",event.target.value)} placeholder="0"/></label>
                        <label className="text-sm font-semibold">Relative tolerance<input className="field mt-1" type="number" min="0" max="1" step="any" value={question.relativeTolerance} onChange={event=>updateQuestion(index,"relativeTolerance",event.target.value)} placeholder="0.01 = 1%"/></label>
                      </>}
                    </div>
                  </div>}
                  {!deterministic&&<label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={question.requiresVisualEvidence} onChange={event=>updateQuestion(index,"requiresVisualEvidence",event.target.checked)}/>This answer requires visual evidence even if the selected type is primarily textual</label>}
                </article>;
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={addQuestion} className="btn"><Plus size={16}/>Add Question</button>
              <button type="button" disabled={saving} onClick={()=>void saveRubric()} className="btn bg-brand-700 text-white disabled:opacity-50">{saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>}Save Draft</button>
              <button type="button" disabled={saving||!readiness.draftRubric||!marksMatch} onClick={()=>void activateRubric()} className="btn border-emerald-200 text-emerald-700 disabled:opacity-40"><CheckCircle2 size={16}/>Activate Draft</button>
            </div>
          </section>
        </>}
      </div>
    </main>
    <style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:white}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-size:.875rem;font-weight:700}`}</style>
  </div>;
}

function StatusCard({label,ok,value}:{label:string;ok:boolean;value:string}) {
  return <div className="rounded-xl border bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 font-bold ${ok?"text-emerald-700":"text-amber-700"}`}>{value}</p></div>;
}
