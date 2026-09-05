"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileCheck2, Loader2, Upload } from "lucide-react";
import { AuthGate, getAccessToken } from "../../../components/auth-provider";
import { openAuthenticatedDocument } from "../../../components/authenticated-download";
import { documentAsBase64, validateDocumentFile } from "../../../components/document-upload";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Exam = { id: string; name: string; examDate: string; maximumMarks: number; subject: { name: string }; questionPaper: { fileName: string } | null; answerSheet: { fileName: string; status: string; isLate: boolean; marksObtained: string | null; teacherRemarks: string | null; finalizedAt: string | null } | null };
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });

async function parse(response: Response) {
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.error?.message ?? "Request failed");
  return value;
}

function Content() {
  const [rows, setRows] = useState<Exam[]>([]), [loading, setLoading] = useState(true), [submitting, setSubmitting] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await fetch(`${API}/exam-workflow/examinations`, { headers: headers() }).then(parse)).data); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load examinations"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(exam: Exam, file: File | null) {
    if (!file) return;
    const validation = validateDocumentFile(file, "answer-sheet");
    if (validation) { setError(validation); return; }
    setSubmitting(exam.id); setError("");
    try {
      await fetch(`${API}/exam-workflow/examinations/${exam.id}/answer-sheet`, { method: "PUT", headers: headers(), body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64: await documentAsBase64(file) }) }).then(parse);
      setNotice("Answer sheet submitted successfully"); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Submission failed"); }
    finally { setSubmitting(""); }
  }

  async function paper(exam: Exam) {
    setError("");
    try { await openAuthenticatedDocument({ url: `${API}/exam-workflow/examinations/${exam.id}/question-paper`, token: getAccessToken() ?? "", fileName: exam.questionPaper?.fileName ?? "question-paper", fallbackError: "Paper unavailable" }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Paper unavailable"); }
  }

  return <main className="min-h-screen bg-slate-50 p-5 md:p-10"><div className="mx-auto max-w-5xl"><header><p className="text-sm font-bold text-brand-700">STUDENT PORTAL</p><h1 className="text-3xl font-bold">Examinations & Answer Sheets</h1><p className="text-slate-500">Download published papers and submit your own answer sheet securely.</p></header>{notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}<section className="mt-6 space-y-4">{loading ? <Loader2 className="mx-auto mt-20 animate-spin"/> : rows.length ? rows.map(exam => { const finalized = Boolean(exam.answerSheet?.finalizedAt), reviewLocked = Boolean(exam.answerSheet && ["UNDER_REVIEW", "EVALUATED", "RETURNED"].includes(exam.answerSheet.status)), replacementLocked = finalized || reviewLocked; return <article key={exam.id} className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{exam.name}</h2><p className="text-sm text-slate-500">{exam.subject.name} · {exam.examDate.slice(0, 10)} · {exam.maximumMarks} marks</p></div><div className="flex flex-wrap gap-2">{exam.questionPaper && <button className="btn" onClick={() => void paper(exam)}><Download size={16}/>Question Paper</button>}<label className={`btn cursor-pointer bg-brand-700 text-white ${replacementLocked || submitting === exam.id ? "pointer-events-none opacity-50" : ""}`}>{submitting === exam.id ? <Loader2 className="animate-spin" size={16}/> : <Upload size={16}/>} {finalized ? "Submission Finalized" : reviewLocked ? "Submission Under Review" : exam.answerSheet ? "Replace Answer Sheet" : "Submit Answer Sheet"}<input disabled={replacementLocked || submitting === exam.id} className="hidden" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/png,image/jpeg" onChange={event => void submit(exam, event.target.files?.[0] ?? null)}/></label></div></div><p className="mt-2 text-xs text-slate-500">PDF, JPG, JPEG or PNG. Maximum 10 MB.</p>{exam.answerSheet && <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><b>{finalized ? "FINALIZED" : exam.answerSheet.status}</b>{exam.answerSheet.isLate && <span className="text-amber-700"> · Late submission</span>}<p>{exam.answerSheet.fileName}</p>{exam.answerSheet.marksObtained !== null && <p className="mt-2">Marks: <b>{exam.answerSheet.marksObtained}/{exam.maximumMarks}</b></p>}{exam.answerSheet.teacherRemarks && <p>Feedback: {exam.answerSheet.teacherRemarks}</p>}</div>}</article>; }) : <div className="py-20 text-center text-slate-500"><FileCheck2 className="mx-auto mb-2"/>No examinations are currently available.</div>}</section></div><style jsx global>{`.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-size:.875rem;font-weight:700}`}</style></main>;
}

export default function Page() { return <AuthGate roles={["STUDENT"]}><Content/></AuthGate>; }
