"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Eye, Loader2, NotebookPen, Pencil, Plus, Send, X } from "lucide-react";
import { AuthGate, errorMessage, getAccessToken } from "../../../components/auth-provider";
import { openAuthenticatedDocument } from "../../../components/authenticated-download";
import { documentAsBase64, validateDocumentFile } from "../../../components/document-upload";
import { formatInstitutionDate, formatInstitutionDateTime, institutionDateTimeInput } from "../../../components/institution-time";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const ROOT = "/teacher/homeworks";

type Named = { id: string; name: string };
type BatchOption = Named & { branchId: string; courseId: string; academicSessionId: string; course: { title: string } };
type SubjectOption = { id: string; name: string; code: string };
type Options = {
  branches: Named[];
  batches: BatchOption[];
  teachers: Array<{ id: string; branchId: string; user: { name: string } }>;
  timetables: Array<{ id: string; batchId: string; subjectId: string; teacherId: string; day: string; periodNumber: number }>;
  timeZone: string;
  locale: string;
};
type Submission = {
  id: string;
  submittedAt: string;
  attachmentName: string | null;
  marksObtained: number | null;
  feedback: string | null;
  status: string;
  student: { admissionNo: string; rollNo: string; user: { name: string } };
};
type Homework = {
  id: string;
  title: string;
  description: string;
  type: string;
  assignedDate: string;
  dueDate: string;
  maximumMarks: number;
  status: string;
  remarks: string | null;
  attachmentName: string | null;
  branch: Named;
  course: { id: string; title: string };
  batch: Named;
  subject: Named;
  teacher: { id: string; user: { name: string } };
  timetable: { id: string } | null;
  submissions: Submission[];
  _count: { submissions: number };
};
type Form = {
  title: string;
  description: string;
  branchId: string;
  courseId: string;
  batchId: string;
  subjectId: string;
  teacherId: string;
  timetableId: string;
  type: string;
  assignedDate: string;
  dueDate: string;
  maximumMarks: number;
  status: string;
  remarks: string;
  attachment?: { name: string; mimeType: string; base64: string };
};

const emptyForm = (): Form => ({
  title: "",
  description: "",
  branchId: "",
  courseId: "",
  batchId: "",
  subjectId: "",
  teacherId: "",
  timetableId: "",
  type: "HOMEWORK",
  assignedDate: new Date().toISOString().slice(0, 10),
  dueDate: "",
  maximumMarks: 100,
  status: "DRAFT",
  remarks: "",
});

function headers() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` };
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...init?.headers } });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message ?? "Unable to complete the Homework request");
  return result;
}

function Badge({ value }: { value: string }) {
  return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{value.replaceAll("_", " ")}</span>;
}

function TeacherHomeworkContent() {
  const [items, setItems] = useState<Homework[]>([]);
  const [options, setOptions] = useState<Options>({ branches: [], batches: [], teachers: [], timetables: [], timeZone: "UTC", locale: "en-IN" });
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [error, setError] = useState("");
  const [subjectError, setSubjectError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"add" | "edit" | "view" | null>(null);
  const [selected, setSelected] = useState<Homework | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [evaluation, setEvaluation] = useState({ id: "", marksObtained: 0, feedback: "" });

  const loadOptions = useCallback(async () => {
    const result = await request(`${ROOT}/options`);
    setOptions(result.data);
    return result.data as Options;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, dashboard] = await Promise.all([
        request(`${ROOT}?limit=100&sortBy=dueDate&sortOrder=desc`),
        request(`${ROOT}/dashboard`),
        loadOptions(),
      ]);
      setItems(list.data);
      setStats(dashboard.data);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [loadOptions]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (mode !== "add" && mode !== "edit") return;
    void loadOptions().then(data => {
      setForm(current => ({
        ...current,
        teacherId: data.teachers[0]?.id ?? "",
        branchId: current.branchId || data.branches[0]?.id || "",
      }));
    }).catch(cause => setError(errorMessage(cause)));
  }, [loadOptions, mode]);

  const selectedBatch = options.batches.find(batch => batch.id === form.batchId);
  useEffect(() => {
    if ((mode !== "add" && mode !== "edit") || !form.branchId || !form.courseId || !form.batchId || !form.teacherId || !selectedBatch?.academicSessionId) {
      setSubjects([]);
      setSubjectError("");
      return;
    }
    const params = new URLSearchParams({
      branchId: form.branchId,
      courseId: form.courseId,
      batchId: form.batchId,
      teacherId: form.teacherId,
      academicSessionId: selectedBatch.academicSessionId,
      effectiveAt: new Date().toISOString(),
    });
    setLoadingSubjects(true);
    setSubjectError("");
    void request(`/teacher/subject-options?${params}`).then(result => {
      setSubjects(result.data);
      if (!result.data.length) setSubjectError("No eligible subjects for this selection.");
    }).catch(cause => {
      setSubjects([]);
      setSubjectError(errorMessage(cause));
    }).finally(() => setLoadingSubjects(false));
  }, [form.batchId, form.branchId, form.courseId, form.teacherId, mode, selectedBatch?.academicSessionId]);

  const courses = useMemo(() => [...new Map(options.batches.filter(batch => !form.branchId || batch.branchId === form.branchId).map(batch => [batch.courseId, { id: batch.courseId, title: batch.course.title }])).values()], [form.branchId, options.batches]);
  const batches = options.batches.filter(batch => batch.branchId === form.branchId && batch.courseId === form.courseId);
  const timetables = options.timetables.filter(period => period.batchId === form.batchId && period.subjectId === form.subjectId && period.teacherId === form.teacherId);
  const rows = items.filter(item => [item.title, item.type, item.course.title, item.batch.name, item.subject.name, item.status].some(value => value.toLowerCase().includes(query.toLowerCase())));

  function openAdd() {
    const next = emptyForm();
    next.branchId = options.branches[0]?.id ?? "";
    next.teacherId = options.teachers[0]?.id ?? "";
    setSelected(null);
    setForm(next);
    setMode("add");
  }

  function openEdit(item: Homework) {
    setSelected(item);
    setForm({
      title: item.title,
      description: item.description,
      branchId: item.branch.id,
      courseId: item.course.id,
      batchId: item.batch.id,
      subjectId: item.subject.id,
      teacherId: item.teacher.id,
      timetableId: item.timetable?.id ?? "",
      type: item.type,
      assignedDate: item.assignedDate.slice(0, 10),
      dueDate: institutionDateTimeInput(item.dueDate, options.timeZone),
      maximumMarks: item.maximumMarks,
      status: item.status,
      remarks: item.remarks ?? "",
    });
    setMode("edit");
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const invalid = validateDocumentFile(file, "homework");
    if (invalid) return setError(invalid);
    setUploading(true);
    try {
      const base64 = await documentAsBase64(file);
      setForm(current => ({ ...current, attachment: { name: file.name, mimeType: file.type, base64 } }));
    } catch {
      setError("Unable to read the selected attachment.");
    } finally {
      setUploading(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const path = mode === "add" ? ROOT : `${ROOT}/${selected!.id}`;
      await request(path, {
        method: mode === "add" ? "POST" : "PATCH",
        body: JSON.stringify({ ...form, timetableId: form.timetableId || null, remarks: form.remarks || null }),
      });
      setMode(null);
      setNotice(mode === "add" ? "Homework created." : "Homework updated.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(item: Homework, status: "PUBLISHED" | "CLOSED") {
    setError("");
    try {
      await request(`${ROOT}/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice(status === "PUBLISHED" ? "Homework published." : "Homework closed.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function download(path: string, fileName: string) {
    setError("");
    try {
      await openAuthenticatedDocument({ url: `${API}${path}`, token: getAccessToken() ?? "", fileName, fallbackError: "Unable to download the document" });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function evaluate() {
    if (!evaluation.id || !evaluation.feedback.trim()) return setError("Enter marks and feedback before saving the evaluation.");
    setSaving(true);
    setError("");
    try {
      await request(`${ROOT}/submissions/${evaluation.id}/evaluate`, { method: "PATCH", body: JSON.stringify({ marksObtained: evaluation.marksObtained, feedback: evaluation.feedback }) });
      setEvaluation({ id: "", marksObtained: 0, feedback: "" });
      setMode(null);
      setNotice("Submission evaluated.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return <main className="min-h-screen bg-slate-50 p-5 md:p-10"><div className="mx-auto max-w-7xl">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/teacher" className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-brand-700"><ArrowLeft size={16}/>Teacher portal</Link><p className="text-xs font-black uppercase tracking-wide text-brand-700">Teacher workspace</p><h1 className="text-3xl font-black">Homework Management</h1><p className="mt-1 text-slate-500">Create and manage Homework only for your active academic allocations.</p></div><button disabled={!options.batches.length} onClick={openAdd} className="btn bg-brand-700 text-white" title={options.batches.length ? "Create Homework" : "No eligible classes assigned"}><Plus size={17}/>Create Homework</button></header>
    {notice && <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-emerald-700">{notice}</p>}
    {error && <div role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-red-700"><b>Unable to load Homework</b><p className="text-sm">{error}</p><button className="btn mt-3" onClick={() => void load()}>Try again</button></div>}
    <section className="mt-6 grid gap-3 sm:grid-cols-5">{[["Total", stats.total], ["Published", stats.published], ["Overdue", stats.overdue], ["Submissions", stats.submissions], ["To review", stats.pendingEvaluation]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border bg-white p-4"><small className="uppercase text-slate-400">{label}</small><p className="text-2xl font-black">{value ?? 0}</p></div>)}</section>
    <label className="mt-6 block max-w-xl"><span className="sr-only">Search Homework</span><input className="field" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search title, course, batch, subject or status"/></label>
    {loading ? (
      <div className="grid min-h-[45vh] place-items-center"><div className="text-center"><Loader2 className="mx-auto animate-spin text-brand-700"/><p className="mt-3 text-sm text-slate-500">Loading Homework…</p></div></div>
    ) : rows.length ? (
      <section className="mt-6 overflow-hidden rounded-2xl border bg-white">
        {!options.batches.length && <div className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-900">No active allocation is currently available. Historical Homework remains viewable, but management actions require an active, effective allocation.</div>}
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50"><tr>{["Homework", "Course / Batch", "Subject", "Assigned", "Due", "Marks", "Submissions", "Status", "Actions"].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{rows.map(item => <tr key={item.id} className="border-t"><td className="px-4 py-3"><b>{item.title}</b><p className="text-xs text-slate-500">{item.type.replaceAll("_", " ")}</p></td><td className="px-4 py-3">{item.course.title}<br/><span className="text-slate-500">{item.batch.name}</span></td><td className="px-4 py-3">{item.subject.name}</td><td className="px-4 py-3">{formatInstitutionDate(item.assignedDate, options.locale)}</td><td className="px-4 py-3">{formatInstitutionDateTime(item.dueDate, options)}</td><td className="px-4 py-3">{item.maximumMarks}</td><td className="px-4 py-3">{item._count.submissions}</td><td className="px-4 py-3"><Badge value={item.status}/></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button className="btn" title="View Homework and submissions" onClick={() => { setSelected(item); setMode("view"); }}><Eye size={15}/>View</button><button className="btn" title="Edit this Homework" disabled={!options.batches.length} onClick={() => openEdit(item)}><Pencil size={15}/>Edit</button>{item.status === "DRAFT" && <button className="btn" disabled={!options.batches.length} title="Publish this Homework" onClick={() => void changeStatus(item, "PUBLISHED")}><Send size={15}/>Publish</button>}{item.status === "PUBLISHED" && <button className="btn" disabled={!options.batches.length} title="Close this Homework" onClick={() => void changeStatus(item, "CLOSED")}><X size={15}/>Close</button>}</div></td></tr>)}</tbody></table></div>
      </section>
    ) : !options.batches.length ? (
      <div className="mt-6 rounded-2xl border bg-white p-12 text-center"><NotebookPen className="mx-auto text-slate-300"/><h2 className="mt-3 font-black">No eligible classes or batches assigned to you</h2><p className="mt-1 text-sm text-slate-500">An active, effective Teacher allocation with a confirmed Subject is required.</p></div>
    ) : (
      <div className="mt-6 rounded-2xl border bg-white p-12 text-center"><NotebookPen className="mx-auto text-slate-300"/><h2 className="mt-3 font-black">{query ? "No Homework matches your search" : "No Homework assigned yet"}</h2><p className="mt-1 text-sm text-slate-500">{query ? "Try another title, course, batch, Subject or status." : "Create Homework for one of your eligible classes, batches and Subjects."}</p></div>
    )}
  </div>
  {mode && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"><div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-black">{mode === "add" ? "Create Homework" : mode === "edit" ? "Edit Homework" : "Homework and submissions"}</h2><button aria-label="Close dialog" title="Close" onClick={() => setMode(null)}><X/></button></div>
    {mode === "view" && selected ? <div className="mt-5"><div className="rounded-xl border p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-black">{selected.title}</h3><p className="text-sm text-slate-500">{selected.course.title} · {selected.batch.name} · {selected.subject.name}</p></div><Badge value={selected.status}/></div><p className="mt-4 whitespace-pre-wrap text-sm">{selected.description}</p>{selected.attachmentName && <button className="btn mt-4" onClick={() => void download(`${ROOT}/${selected.id}/attachment`, selected.attachmentName!)}><Download size={16}/>Download attachment</button>}</div><h3 className="mt-6 font-black">Student submissions ({selected.submissions.length})</h3>{selected.submissions.length ? <div className="mt-3 space-y-3">{selected.submissions.map(submission => <article key={submission.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{submission.student.user.name}</b><p className="text-sm text-slate-500">Admission {submission.student.admissionNo} · Roll {submission.student.rollNo} · {formatInstitutionDateTime(submission.submittedAt, options)}</p><Badge value={submission.status}/></div><div className="flex gap-2">{submission.attachmentName && <button className="btn" onClick={() => void download(`${ROOT}/submissions/${submission.id}/attachment`, submission.attachmentName!)}><Download size={15}/>Submission</button>}{submission.marksObtained === null && <button className="btn" onClick={() => setEvaluation({ id: submission.id, marksObtained: 0, feedback: "" })}>Evaluate</button>}</div></div>{submission.marksObtained !== null && <p className="mt-3 text-sm">Marks: <b>{submission.marksObtained}/{selected.maximumMarks}</b>{submission.feedback && <> · Feedback: {submission.feedback}</>}</p>}{evaluation.id === submission.id && <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3"><label>Marks<input className="field" type="number" min="0" max={selected.maximumMarks} value={evaluation.marksObtained} onChange={event => setEvaluation(current => ({ ...current, marksObtained: Number(event.target.value) }))}/></label><label className="sm:col-span-2">Feedback<input className="field" value={evaluation.feedback} onChange={event => setEvaluation(current => ({ ...current, feedback: event.target.value }))}/></label><button disabled={saving} className="btn bg-brand-700 text-white sm:col-span-3" onClick={() => void evaluate()}>{saving && <Loader2 className="animate-spin" size={16}/>}Save evaluation</button></div>}</article>)}</div> : <p className="mt-3 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No submissions received yet.</p>}</div> : <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-3"><label>Title<input required className="field" value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))}/></label><label>Type<select className="field" value={form.type} onChange={event => setForm(current => ({ ...current, type: event.target.value }))}>{["HOMEWORK", "ASSIGNMENT", "PROJECT", "PRACTICE", "OTHER"].map(value => <option key={value}>{value}</option>)}</select></label><label>Assigned date<input required className="field" type="date" value={form.assignedDate} onChange={event => setForm(current => ({ ...current, assignedDate: event.target.value, courseId: "", batchId: "", subjectId: "", timetableId: "" }))}/></label><label>Course<select required className="field" value={form.courseId} onChange={event => setForm(current => ({ ...current, courseId: event.target.value, batchId: "", subjectId: "", timetableId: "" }))}><option value="">Select an assigned course</option>{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label>Batch / Section<select required className="field" value={form.batchId} onChange={event => setForm(current => ({ ...current, batchId: event.target.value, subjectId: "", timetableId: "" }))}><option value="">{batches.length ? "Select an assigned batch" : "No eligible batches for this course"}</option>{batches.map(batch => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label><label>Subject<select required disabled={loadingSubjects || !form.batchId} className="field" value={form.subjectId} onChange={event => setForm(current => ({ ...current, subjectId: event.target.value, timetableId: "" }))}><option value="">{loadingSubjects ? "Loading eligible Subjects…" : subjects.length ? "Select an eligible Subject" : "No eligible Subjects"}</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>{subjectError && <small className="text-red-600">{subjectError}</small>}</label><label>Timetable (optional)<select className="field" value={form.timetableId} onChange={event => setForm(current => ({ ...current, timetableId: event.target.value }))}><option value="">No linked period</option>{timetables.map(period => <option key={period.id} value={period.id}>{period.day} · Period {period.periodNumber}</option>)}</select></label><label>Due date<input required className="field" type="datetime-local" value={form.dueDate} onChange={event => setForm(current => ({ ...current, dueDate: event.target.value }))}/></label><label>Maximum marks<input required className="field" type="number" min="1" value={form.maximumMarks} onChange={event => setForm(current => ({ ...current, maximumMarks: Number(event.target.value) }))}/></label><label>Status<select disabled className="field" value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option>{mode === "edit" && form.status === "CLOSED" && <option value="CLOSED">Closed</option>}{mode === "edit" && form.status === "ARCHIVED" && <option value="ARCHIVED">Archived</option>}</select>{mode === "edit" && <small className="text-slate-500">Use the Publish or Close action to change status.</small>}</label><label>Attachment<input disabled={uploading} className="field" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={event => void upload(event)}/><small className="text-slate-500">{uploading ? "Reading attachment…" : "PDF, JPG, PNG, DOC or DOCX; maximum 5 MB."}</small></label><label className="sm:col-span-3">Description<textarea required rows={4} className="field" value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))}/></label><label className="sm:col-span-3">Remarks<textarea rows={3} className="field" value={form.remarks} onChange={event => setForm(current => ({ ...current, remarks: event.target.value }))}/></label><button disabled={saving || uploading || !subjects.length} className="btn bg-brand-700 text-white sm:col-span-3">{(saving || uploading) && <Loader2 className="animate-spin" size={16}/>}Save Homework</button></form>}
  </div></div>}
  <style jsx global>{`.field{width:100%;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .8rem;background:transparent}.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.65rem .9rem;font-size:.875rem;font-weight:700}.btn:disabled{opacity:.55;cursor:not-allowed}`}</style></main>;
}

export default function Page() {
  return <AuthGate roles={["TEACHER"]}><TeacherHomeworkContent/></AuthGate>;
}
