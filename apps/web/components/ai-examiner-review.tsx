"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, ExternalLink, FileText, Loader2, ShieldCheck } from "lucide-react";
import { getAccessToken } from "./auth-provider";
import { openAuthenticatedDocument } from "./authenticated-download";
import Sidebar from "./sidebar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });

type Breakdown={criterion:string;maxMarks:number;awardedMarks:number;rationale:string};
type Question={
  id:string;questionKey:string;maxMarks:number|string;suggestedMarks:number|string|null;finalMarks:number|string|null;
  confidence:number|string|null;rubricBreakdown:Breakdown[]|null;feedback:string|null;extractedAnswer:string|null;
  reviewRequired:boolean;teacherComment:string|null;
};
type Evaluation={
  id:string;revision:number;status:string;engineVersion:string;provider:string|null;model:string|null;extractedText:string|null;
  suggestedMarks:number|string|null;confidence:number|string|null;feedback:string|null;diagnostics:any;errorCode:string|null;errorMessage:string|null;
  completedAt:string|null;reviewedAt:string|null;
  questions:Question[];
  answerSheet:{id:string;examinationId:string;fileName:string;mimeType:string;status:string;isLate:boolean;marksObtained:number|string|null;finalizedAt:string|null;student:{id:string;admissionNo:string|null;rollNo:string|null;user:{name:string}}};
  rubric:{id:string;version:number;status:string;instructions:string|null;rubric:any;modelAnswer:any};
};

async function responseBody(response:Response){
  const json=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(json?.error?.message??"Request failed");
  return json;
}

export function AIExaminerReview({evaluationId,teacherView=false}:{evaluationId:string;teacherView?:boolean}){
  const [evaluation,setEvaluation]=useState<Evaluation|null>(null);
  const [marks,setMarks]=useState<Record<string,string>>({});
  const [comments,setComments]=useState<Record<string,string>>({});
  const [teacherRemarks,setTeacherRemarks]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [redPenExceptions,setRedPenExceptions]=useState<number|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const json=await fetch(`${API}/ai-examiner/evaluations/${evaluationId}`,{headers:headers()}).then(responseBody);
      const data=json.data as Evaluation;
      setEvaluation(data);
      setMarks(Object.fromEntries(data.questions.map(question=>[question.id,question.finalMarks!=null?String(question.finalMarks):question.suggestedMarks!=null?String(question.suggestedMarks):""])));
      setComments(Object.fromEntries(data.questions.map(question=>[question.id,question.teacherComment??""])));
      setTeacherRemarks(data.feedback??"");
      setError("");
      if(data.status==="REVIEW_REQUIRED"){
        void fetch(`${API}/ai-examiner/evaluations/${data.id}/checked-copy/draft`,{method:"POST",headers:headers()})
          .then(responseBody)
          .then(redPen=>{
            const annotations=Array.isArray(redPen?.data?.annotations)?redPen.data.annotations:[];
            setRedPenExceptions(annotations.filter((row:any)=>row?.approvalState==="POSITION_REVIEW_REQUIRED"||!row?.anchor).length);
          })
          .catch(()=>setRedPenExceptions(null));
      }else setRedPenExceptions(null);
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to load AI evaluation");}
    finally{setLoading(false);}
  },[evaluationId]);

  useEffect(()=>{void load();},[load]);

  const total=useMemo(()=>evaluation?.questions.reduce((sum,question)=>sum+(Number(marks[question.id])||0),0)??0,[evaluation,marks]);
  const suggested=evaluation?.suggestedMarks==null?null:Number(evaluation.suggestedMarks);
  const readonly=evaluation?.status==="APPROVED";

  async function openAnswerSheet(){
    if(!evaluation)return;
    try{
      await openAuthenticatedDocument({url:`${API}/exam-workflow/answer-sheets/${evaluation.answerSheet.id}/file`,token:getAccessToken()??"",fileName:evaluation.answerSheet.fileName,fallbackError:"Answer sheet unavailable"});
    }catch(cause){setError(cause instanceof Error?cause.message:"Answer sheet unavailable");}
  }

  async function openCheckedCopy(){
    if(!evaluation||evaluation.status!=="APPROVED")return;
    try{
      await openAuthenticatedDocument({
        url:`${API}/ai-examiner/evaluations/${evaluation.id}/checked-copy`,
        token:getAccessToken()??"",
        fileName:`${evaluation.answerSheet.fileName.replace(/\.[^.]+$/,"")}-checked.pdf`,
        fallbackError:"Checked copy unavailable",
      });
    }catch(cause){setError(cause instanceof Error?cause.message:"Checked copy unavailable");}
  }

  async function openQuestionPaper(){
    if(!evaluation)return;
    try{
      await openAuthenticatedDocument({url:`${API}/exam-workflow/examinations/${evaluation.answerSheet.examinationId}/question-paper`,token:getAccessToken()??"",fileName:"question-paper",fallbackError:"Question paper unavailable"});
    }catch(cause){setError(cause instanceof Error?cause.message:"Question paper unavailable");}
  }

  async function approve(){
    if(!evaluation||readonly)return;
    setSaving(true);setError("");setNotice("");
    try{
      const questions=evaluation.questions.map(question=>({
        questionKey:question.questionKey,
        finalMarks:Number(marks[question.id]),
        teacherComment:comments[question.id]?.trim()||null,
      }));
      const json=await fetch(`${API}/ai-examiner/evaluations/${evaluation.id}/approve`,{
        method:"POST",headers:headers(),body:JSON.stringify({questions,teacherRemarks:teacherRemarks.trim()||null}),
      }).then(responseBody);

      let checkedCopyMessage=" Checked-copy scores were synchronized automatically.";
      try{
        const redPen=await fetch(`${API}/ai-examiner/evaluations/${evaluation.id}/checked-copy/draft`,{method:"POST",headers:headers()}).then(responseBody);
        const revision=redPen?.data;
        const annotations=Array.isArray(revision?.annotations)?revision.annotations:[];
        const exceptions=annotations.filter((row:any)=>row?.approvalState==="POSITION_REVIEW_REQUIRED"||!row?.anchor).length;
        if(revision?.id&&exceptions===0){
          await fetch(`${API}/ai-examiner/checked-copy/revisions/${revision.id}/approve`,{method:"POST",headers:headers()}).then(responseBody);
          checkedCopyMessage=" AI Red-Pen had no exceptions, so the checked copy was automatically approved and rendered.";
        }else if(exceptions>0){
          checkedCopyMessage=` Checked-copy scores were synchronized; ${exceptions} Red-Pen exception(s) remain for teacher review.`;
        }
      }catch{
        // Grading approval is authoritative and must remain successful even if checked-copy warmup/rendering needs retry.
      }
      setNotice(`AI evaluation approved and finalized at ${json.meta.finalMarks} marks.${checkedCopyMessage}`);
      await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to approve AI evaluation");}
    finally{setSaving(false);}
  }

  return <div className="min-h-screen bg-slate-50">
    {!teacherView&&<Sidebar/>}
    <main className={`p-5 md:p-10 ${teacherView?"":"md:ml-64"}`}>
      <div className="mx-auto max-w-6xl">
        <Link href={teacherView?"/teacher/ai-examiner":"/admin/ai-examiner"} className="mb-4 inline-block font-bold text-brand-700">← Ranpal AI Examiner</Link>
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-sm font-bold text-brand-700">RANPAL AI EXAMINER</p><h1 className="text-3xl font-bold">Teacher Review</h1><p className="mt-1 text-slate-500">Review every AI suggestion before final marks enter the examination result workflow.</p></div>
          <ShieldCheck className="text-brand-700" size={34}/>
        </header>
        {notice&&<p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">{notice}</p>}
        {error&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
        {loading?<Loader2 className="mx-auto my-20 animate-spin"/>:evaluation&&<>
          <section className="mt-6 rounded-2xl border bg-white p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-bold">{evaluation.answerSheet.student.user.name}</h2>
                <p className="text-sm text-slate-500">{evaluation.answerSheet.student.admissionNo??"No admission number"} · AI revision {evaluation.revision}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold">{evaluation.status}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">Engine {evaluation.engineVersion}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">{evaluation.model??"No model"}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">AI confidence {Math.round(Number(evaluation.confidence??0)*100)}%</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn" onClick={()=>void openQuestionPaper()}><FileText size={16}/>Question Paper</button>
                <button className="btn" onClick={()=>void openAnswerSheet()}><ExternalLink size={16}/>Answer Sheet</button>
                {(evaluation.status==="REVIEW_REQUIRED"||readonly)&&<Link className="btn border-red-200 text-red-700" href={`${teacherView?"/teacher":"/admin"}/ai-examiner/checked-copy/${evaluation.id}`}>{readonly?"Review Checked Copy":redPenExceptions==null?"Review AI Red-Pen Draft":redPenExceptions===0?"AI Red-Pen Ready":"Review Red-Pen Exceptions ("+redPenExceptions+")"}</Link>}
                {readonly&&<button className="btn border-red-200 text-red-700" onClick={()=>void openCheckedCopy()}><Download size={16}/>Download Approved Copy</button>}
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Metric label="AI suggested" value={suggested==null?"Pending review":String(suggested)}/>
              <Metric label="Teacher total" value={String(total)}/>
              <Metric label="Questions flagged" value={String(evaluation.questions.filter(question=>question.reviewRequired).length)}/>
            </div>
            {evaluation.status==="REVIEW_REQUIRED"&&redPenExceptions!=null&&<p className={`mt-3 rounded-xl p-3 text-sm ${redPenExceptions?"bg-amber-50 text-amber-900":"bg-emerald-50 text-emerald-800"}`}>{redPenExceptions?`AI Red-Pen is ready; only ${redPenExceptions} placement exception(s) need attention.`:"AI Red-Pen is fully placed with no position exceptions. Review marks, then finalize."}</p>}
            {evaluation.feedback&&<div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">AI overall feedback</p><p className="mt-2 text-sm">{evaluation.feedback}</p></div>}
          </section>

          <section className="mt-5 space-y-4">
            {evaluation.questions.map(question=>{
              const max=Number(question.maxMarks);
              const rawMark=marks[question.id]??"";
              const current=Number(rawMark);
              const invalid=rawMark.trim()===""||!Number.isFinite(current)||current < -max||current>max;
              return <article key={question.id} className={`rounded-2xl border bg-white p-5 ${question.reviewRequired?"border-amber-200":""}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><h3 className="text-lg font-bold">{question.questionKey}</h3><p className="text-sm text-slate-500">Maximum {max} · AI suggested {question.suggestedMarks==null?"—":Number(question.suggestedMarks)} · Confidence {Math.round(Number(question.confidence??0)*100)}%</p></div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${question.reviewRequired?"bg-amber-50 text-amber-800":"bg-emerald-50 text-emerald-700"}`}>{question.reviewRequired?"Teacher attention required":"High-confidence suggestion"}</span>
                </div>
                {question.extractedAnswer&&<div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Extracted student answer</p><p className="mt-2 whitespace-pre-wrap text-sm">{question.extractedAnswer}</p></div>}
                {question.feedback&&<div className="mt-3 text-sm"><b>AI feedback:</b> {question.feedback}</div>}
                {Array.isArray(question.rubricBreakdown)&&question.rubricBreakdown.length>0&&<div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="py-2">Criterion</th><th>AI marks</th><th>Max</th><th>Reason</th></tr></thead><tbody>{question.rubricBreakdown.map((row,index)=><tr key={index} className="border-b last:border-0"><td className="py-2 pr-3">{row.criterion}</td><td>{row.awardedMarks}</td><td>{row.maxMarks}</td><td>{row.rationale}</td></tr>)}</tbody></table></div>}
                <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr]">
                  <label className="text-sm font-semibold">Final marks
                    <input disabled={readonly} className={`field mt-1 ${invalid?"border-red-400":""}`} type="number" min={-max} max={max} step="0.25" value={marks[question.id]??""} onChange={event=>setMarks(state=>({...state,[question.id]:event.target.value}))}/>
                    {invalid&&<span className="mt-1 block text-xs text-red-600">Enter a value from {-max} to {max}. Negative marks are allowed only when the marking rule requires them.</span>}
                  </label>
                  <label className="text-sm font-semibold">Teacher comment
                    <textarea disabled={readonly} className="field mt-1 min-h-20" value={comments[question.id]??""} onChange={event=>setComments(state=>({...state,[question.id]:event.target.value}))} placeholder="Optional reason for accepting or overriding the AI suggestion."/>
                  </label>
                </div>
              </article>;
            })}
          </section>

          <section className="mt-5 rounded-2xl border bg-white p-5">
            <label className="text-sm font-semibold">Final teacher remarks<textarea disabled={readonly} className="field mt-1 min-h-24" value={teacherRemarks} onChange={event=>setTeacherRemarks(event.target.value)} placeholder="Feedback that may be included with the finalized evaluation."/></label>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-bold">Final total: {total}</p><p className="text-xs text-slate-500">Approval finalizes the answer sheet and writes the teacher-approved marks into the examination result workflow.</p></div>
              {readonly?<span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 font-bold text-emerald-800"><CheckCircle2 size={18}/>Teacher approved & finalized</span>:<button className="btn bg-emerald-700 text-white disabled:opacity-40" disabled={saving||evaluation.questions.some(question=>{const raw=marks[question.id]??"";const value=Number(raw);const max=Number(question.maxMarks);return raw.trim()===""||!Number.isFinite(value)||value < -max||value>max;})} onClick={()=>void approve()}>{saving?<Loader2 className="animate-spin" size={18}/>:<CheckCircle2 size={18}/>}Approve & Finalize</button>}
            </div>
          </section>
        </>}
      </div>
    </main>
    <style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:white}.field:disabled{background:#f8fafc;color:#64748b}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-size:.875rem;font-weight:700}`}</style>
  </div>;
}

function Metric({label,value}:{label:string;value:string}){
  return <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>;
}
