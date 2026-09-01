"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileCheck2, Loader2, Trash2, Upload } from "lucide-react";
import { AuthGate, getAccessToken } from "../../../components/auth-provider";
import { documentAsBase64, validateDocumentFile } from "../../../components/document-upload";
import Sidebar from "../../../components/sidebar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` });
type Exam = { id: string; name: string; examDate: string; maximumMarks: number; batch: { name: string }; subject: { name: string }; questionPaper: { fileName: string; publishedAt: string | null } | null; _count: { answerSheets: number } };
type Sheet = { id: string; fileName: string; status: string; isLate: boolean; marksObtained: string | null; teacherRemarks: string | null; finalizedAt: string | null; student: { admissionNo: string; rollNo: string; user: { name: string } } };

async function body(response: Response) {
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.error?.message ?? "Request failed");
  return value;
}

function Content() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [selected, setSelected] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [busy, setBusy] = useState(true);
  const [paperBusy, setPaperBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await fetch(`${API}/exam-workflow/examinations`, { headers: headers() }).then(body);
      setExams(result.data);
      setSelected(current => current || result.data[0]?.id || "");
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load examinations"); }
    finally { setBusy(false); }
  }, []);

  const loadSheets = useCallback(async () => {
    if (!selected) { setSheets([]); return; }
    try {
      const value = await fetch(`${API}/exam-workflow/examinations/${selected}/answer-sheets`, { headers: headers() }).then(body);
      setSheets(value.data); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load answer sheets"); }
  }, [selected]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSheets(); }, [loadSheets]);

  async function uploadPaper(file: File | null) {
    if (!file || !selected) return;
    const validation = validateDocumentFile(file, "question-paper");
    if (validation) { setError(validation); return; }
    setPaperBusy(true); setError("");
    try {
      await fetch(`${API}/exam-workflow/examinations/${selected}/question-paper`, { method: "PUT", headers: headers(), body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64: await documentAsBase64(file), publishedAt: new Date().toISOString() }) }).then(body);
      setNotice("Question paper uploaded and published"); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed"); }
    finally { setPaperBusy(false); }
  }

  async function removePaper() {
    if (!selected || !window.confirm("Remove this question paper? Removal is blocked after any answer sheet is submitted.")) return;
    setPaperBusy(true); setError("");
    try {
      const response = await fetch(`${API}/exam-workflow/examinations/${selected}/question-paper`, { method: "DELETE", headers: headers() });
      if (!response.ok) await body(response);
      setNotice("Question paper removed"); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to remove question paper"); }
    finally { setPaperBusy(false); }
  }

  async function evaluate(sheet: Sheet, marks: string, remarks: string, finalize: boolean) {
    if (marks === "") { setError("Enter marks before saving an evaluation."); return; }
    try {
      await fetch(`${API}/exam-workflow/answer-sheets/${sheet.id}/evaluation`, { method: "PATCH", headers: headers(), body: JSON.stringify({ marksObtained: Number(marks), teacherRemarks: remarks || null, finalize }) }).then(body);
      setNotice(finalize ? "Evaluation finalized" : "Evaluation saved as under review"); await loadSheets();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Evaluation failed"); }
  }

  async function download(path: string, name: string) {
    const response = await fetch(`${API}/exam-workflow${path}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } });
    if (!response.ok) return setError((await response.json()).error?.message ?? "Download failed");
    const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
    link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  }

  const exam = exams.find(item => item.id === selected);
  return <div className="min-h-screen bg-slate-50"><Sidebar/><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-6xl">
    <header><p className="text-sm font-bold text-brand-700">EXAMINATIONS</p><h1 className="text-3xl font-bold">Question Papers & Answer Sheets</h1><p className="text-slate-500">Secure uploads, review, marks, feedback and finalization.</p></header>
    {notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    <section className="mt-6 grid gap-4 rounded-2xl border bg-white p-5 md:grid-cols-[1fr_auto]"><label>Examination<select className="field" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Select examination</option>{exams.map(item => <option key={item.id} value={item.id}>{item.name} — {item.subject.name} — {item.batch.name}</option>)}</select></label><div className="flex flex-wrap items-end gap-2"><label className={`btn cursor-pointer bg-brand-700 text-white ${paperBusy ? "pointer-events-none opacity-50" : ""}`}>{paperBusy ? <Loader2 className="animate-spin" size={17}/> : <Upload size={17}/>}Upload / Replace Paper<input disabled={paperBusy} className="hidden" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => void uploadPaper(event.target.files?.[0] ?? null)}/></label>{exam?.questionPaper && <button disabled={paperBusy} className="btn text-red-600" onClick={() => void removePaper()}><Trash2 size={16}/>Remove</button>}</div>{exam?.questionPaper && <p className="text-sm md:col-span-2">Published paper: <button className="font-bold text-brand-700" onClick={() => void download(`/examinations/${exam.id}/question-paper`, exam.questionPaper!.fileName)}>{exam.questionPaper.fileName}</button>{exam._count.answerSheets > 0 && <span className="ml-2 text-slate-500">Locked because submissions exist</span>}</p>}<p className="text-xs text-slate-500 md:col-span-2">PDF, JPG, JPEG, PNG, DOC or DOCX. Maximum 10 MB. Replacement and removal are blocked after submissions to preserve history.</p></section>
    <section className="mt-5 rounded-2xl border bg-white p-5"><h2 className="text-xl font-bold">Student submissions ({sheets.length})</h2>{busy ? <Loader2 className="mx-auto my-12 animate-spin"/> : sheets.length ? <div className="mt-4 space-y-3">{sheets.map(sheet => <Evaluation key={sheet.id} sheet={sheet} maximum={exam?.maximumMarks ?? 0} save={evaluate} download={() => void download(`/answer-sheets/${sheet.id}/file`, sheet.fileName)}/>)}</div> : <div className="py-16 text-center text-slate-500"><FileCheck2 className="mx-auto mb-2"/>No answer sheets submitted.</div>}</section>
  </div></main><style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:transparent}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-size:.875rem;font-weight:700}`}</style></div>;
}

function Evaluation({ sheet, maximum, save, download }: { sheet: Sheet; maximum: number; save: (sheet: Sheet, marks: string, remarks: string, finalize: boolean) => void; download: () => void }) {
  const [marks, setMarks] = useState(sheet.marksObtained ?? ""), [remarks, setRemarks] = useState(sheet.teacherRemarks ?? "");
  useEffect(() => { setMarks(sheet.marksObtained ?? ""); setRemarks(sheet.teacherRemarks ?? ""); }, [sheet.marksObtained, sheet.teacherRemarks]);
  const finalized = Boolean(sheet.finalizedAt);
  return <article className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_120px_2fr_auto]"><div><b>{sheet.student.user.name}</b><p className="text-xs text-slate-500">{sheet.student.admissionNo} · {finalized ? "FINALIZED" : sheet.status}{sheet.isLate ? " · LATE" : ""}</p><button onClick={download} className="mt-2 inline-flex items-center gap-1 text-sm text-brand-700"><Download size={15}/>Open answer sheet</button></div><label>Marks<input disabled={finalized} className="field" type="number" min="0" max={maximum} value={marks} onChange={event => setMarks(event.target.value)}/></label><label>Feedback<textarea disabled={finalized} className="field" value={remarks} onChange={event => setRemarks(event.target.value)}/></label><div className="flex flex-col gap-2"><button disabled={finalized || marks === ""} className="btn disabled:opacity-50" onClick={() => save(sheet, marks, remarks, false)}>Save Review</button><button disabled={finalized || marks === ""} className="btn bg-brand-700 text-white disabled:opacity-50" onClick={() => save(sheet, marks, remarks, true)}>{finalized ? "Finalized" : "Finalize"}</button></div></article>;
}

export default function Page() { return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN", "TEACHER"]}><Content/></AuthGate>; }
