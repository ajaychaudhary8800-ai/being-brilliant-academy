"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, GraduationCap, History, Loader2, RefreshCw, Route } from "lucide-react";
import { AuthGate, getAccessToken } from "../../../../components/auth-provider";
import Sidebar from "../../../../components/sidebar";
import StudentTransitionDialog, { type TransitionBatch, type TransitionStudent } from "../../../../components/student-transition-dialog";
import { useGroupTerminology } from "../../../../components/use-group-terminology";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const headers = () => ({ Authorization: `Bearer ${getAccessToken() ?? ""}` });

type Enrollment = {
  id: string;
  academicSession?: { id: string; name: string } | null;
  branch?: { id: string; branchName: string } | null;
  course?: { id: string; title: string } | null;
  batch?: { id: string; name: string } | null;
  rollNo: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  source: string;
};

type Transition = {
  id: string;
  type: string;
  effectiveDate: string;
  reason: string | null;
  createdAt: string;
  fromEnrollment?: Enrollment | null;
  toEnrollment?: Enrollment | null;
  createdBy?: { id: string; name: string } | null;
};

type Student = TransitionStudent & {
  admissionNo: string;
  gender: string;
  dateOfBirth: string;
  fatherName: string;
  motherName: string;
  parentMobile: string;
  address: string;
  admissionDate: string;
  bloodGroup: string | null;
  category: string | null;
  aadhaarNo: string | null;
  status: string;
  remarks: string | null;
  user: { name: string; email: string; phone: string; avatarUrl: string | null };
};

function date(value?: string | null) { return value ? value.slice(0, 10) : "—"; }

function placementLabel(placement: Enrollment | null | undefined, terms: ReturnType<typeof useGroupTerminology>) {
  if (!placement) return "No destination (terminal outcome)";
  return [placement.course?.title ?? terms.course, placement.batch?.name ?? terms.singular, placement.academicSession?.name].filter(Boolean).join(" · ");
}

async function readPage(path: string) {
  const response = await fetch(`${API}${path}`, { headers: headers() });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "Unable to load student data");
  return { data: json?.data, meta: json?.meta };
}

async function read(path: string) {
  return (await readPage(path)).data;
}

async function readAllBatches() {
  const all: TransitionBatch[] = [];
  const maximumPages = 100;
  for (let page = 1; page <= maximumPages; page += 1) {
    const result = await readPage(`/admin/batches?page=${page}&limit=100`);
    all.push(...(result.data ?? []));
    const totalPages = Number(result.meta?.totalPages);
    if (!Number.isInteger(totalPages) || totalPages < 1) throw new Error("Destination options could not be loaded because pagination metadata was unavailable.");
    if (page >= totalPages) return all;
  }
  throw new Error("Destination options could not be loaded because the pagination limit was reached.");
}

function Detail() {
  const { id } = useParams<{ id: string }>();
  const terms = useGroupTerminology();
  const [data, setData] = useState<Student>();
  const [history, setHistory] = useState<Enrollment[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [batches, setBatches] = useState<TransitionBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const [enrollmentHistoryError, setEnrollmentHistoryError] = useState("");
  const [transitionHistoryError, setTransitionHistoryError] = useState("");
  const [batchError, setBatchError] = useState("");
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [transitionOpen, setTransitionOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setHistoryLoading(true);
    setError("");
    setEnrollmentHistoryError("");
    setTransitionHistoryError("");
    setBatchError("");
    setBatchesLoading(true);
    try {
      const student = await read(`/admin/students/${id}`) as Student;
      setData(student);
      const [enrollmentResult, transitionResult, batchResult] = await Promise.allSettled([
        read(`/admin/students/${id}/academic-history?limit=100`),
        read(`/admin/students/${id}/academic-transitions`),
        readAllBatches(),
      ]);
      if (enrollmentResult.status === "fulfilled") setHistory(enrollmentResult.value ?? []);
      else { setHistory([]); setEnrollmentHistoryError(enrollmentResult.reason instanceof Error ? enrollmentResult.reason.message : "Enrollment history is temporarily unavailable."); }
      if (transitionResult.status === "fulfilled") setTransitions(transitionResult.value ?? []);
      else { setTransitions([]); setTransitionHistoryError(transitionResult.reason instanceof Error ? transitionResult.reason.message : "Transition history is temporarily unavailable."); }
      if (batchResult.status === "fulfilled") setBatches(batchResult.value ?? []);
      else { setBatches([]); setBatchError(batchResult.reason instanceof Error ? batchResult.reason.message : "Destination options could not be loaded."); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load student data");
    } finally {
      setLoading(false);
      setHistoryLoading(false);
      setBatchesLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const transitionStudent = useMemo(() => data ?? null, [data]);
  const enrollmentById = useMemo(() => new Map(history.map(row => [row.id, row])), [history]);
  const refreshAfterTransition = async () => {
    setNotice("Academic transition completed. Refreshing authoritative placement and history…");
    await load();
    setNotice("Academic transition completed.");
  };

  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><Sidebar/><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-6xl">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/admin/students" className="inline-flex items-center gap-2 text-sm font-bold text-brand-700"><ArrowLeft size={17}/>Students</Link><button type="button" className="btn" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/>Refresh</button></div>
    {error ? <p className="mt-6 rounded-xl bg-red-50 p-4 text-red-700" role="alert">{error}</p> : loading || !data ? <Loader2 className="mt-12 animate-spin"/> : <>
      {notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700" role="status">{notice}</p>}
      <section className="mt-6 rounded-2xl bg-brand-800 p-6 text-white"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm opacity-70">{data.admissionNo} · Roll {data.rollNo}</p><h1 className="mt-1 text-3xl font-bold">{data.user.name}</h1><p>{data.course?.title ?? terms.course} · {data.batch.name} · {data.status}</p></div><button type="button" className="btn border-white/30 bg-white text-brand-800" onClick={() => setTransitionOpen(true)}><Route size={17}/>Academic transition</button></div><p className="mt-4 max-w-2xl text-sm text-blue-100">Use Academic transition for {terms.mode === "SCHOOL" ? "promotion, retention, transfer, graduation or leaving" : "moving, retention, transfer, graduation or exit"}. Use Edit Placement only to correct incorrectly entered current data.</p></section>
      <section className="mt-5 grid gap-4 md:grid-cols-3">{Object.entries({"Gender":data.gender,"Date of Birth":date(data.dateOfBirth),"Father":data.fatherName,"Mother":data.motherName,"Mobile":data.user.phone,"Parent Mobile":data.parentMobile,"Email":data.user.email,"Branch / Campus":data.branch.name,[terms.course]:data.course?.title,[terms.singular]:data.batch.name,"Session":data.academicSession,"Admission Date":date(data.admissionDate),"Blood Group":data.bloodGroup,"Category":data.category,"Aadhaar":data.aadhaarNo,"Address":data.address,"Remarks":data.remarks}).map(([label,value]) => <div key={label} className="rounded-xl border bg-white p-4 dark:bg-slate-900"><p className="text-xs font-bold uppercase text-slate-400">{label}</p><p className="mt-1 font-semibold">{String(value ?? "—")}</p></div>)}</section>
      <section className="mt-8 rounded-2xl border bg-white p-5 dark:bg-slate-900"><div className="flex items-center gap-3"><History className="text-brand-700"/><div><h2 className="text-xl font-bold">Academic Journey</h2><p className="text-sm text-slate-500">Enrollment and lifecycle history returned for this administrator.</p></div></div>{enrollmentHistoryError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{enrollmentHistoryError}</p>}{historyLoading ? <Loader2 className="mt-6 animate-spin"/> : enrollmentHistoryError ? null : !history.length ? <p className="mt-6 text-sm text-slate-500">No academic enrollment history found.</p> : <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase dark:bg-slate-950"><tr>{["Session","Branch / Campus",terms.course,terms.singular,"Roll No.","Effective from","Effective to","Status","Source"].map(label => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{history.map(row => <tr key={row.id} className="border-t"><td className="px-3 py-3">{row.academicSession?.name ?? "—"}</td><td className="px-3">{row.branch?.branchName ?? "—"}</td><td className="px-3">{row.course?.title ?? "—"}</td><td className="px-3">{row.batch?.name ?? "—"}</td><td className="px-3">{row.rollNo}</td><td className="px-3">{date(row.effectiveFrom)}</td><td className="px-3">{date(row.effectiveTo)}</td><td className="px-3">{row.status}</td><td className="px-3">{row.source}</td></tr>)}</tbody></table></div>}</section>
      <section className="mt-5 rounded-2xl border bg-white p-5 dark:bg-slate-900"><div className="flex items-center gap-3"><GraduationCap className="text-brand-700"/><div><h2 className="text-xl font-bold">Transition history</h2><p className="text-sm text-slate-500">Immutable academic lifecycle transitions and their actors.</p></div></div>{transitionHistoryError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{transitionHistoryError}</p>}{historyLoading ? <Loader2 className="mt-6 animate-spin"/> : transitionHistoryError ? null : !transitions.length ? <p className="mt-6 text-sm text-slate-500">No academic transitions recorded.</p> : <ol className="mt-5 space-y-4">{transitions.map(row => { const from = enrollmentById.get(row.fromEnrollment?.id ?? "") ?? row.fromEnrollment; const to = enrollmentById.get(row.toEnrollment?.id ?? "") ?? row.toEnrollment; return <li key={row.id} className="relative border-l-2 border-brand-100 pl-5"><span className="absolute -left-[7px] top-1 h-3 w-3 rounded-full bg-brand-700"/><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-bold">{row.type}</h3><time className="text-xs text-slate-500">Effective {date(row.effectiveDate)} · Recorded {date(row.createdAt)}</time></div><p className="mt-1 text-sm">{placementLabel(from, terms)} {to ? <><span className="mx-2 text-slate-400">→</span>{placementLabel(to, terms)}</> : <span className="ml-2 text-slate-500">· terminal outcome</span>}</p>{row.reason && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-600">{row.reason}</p>}<p className="mt-2 text-xs text-slate-500">Recorded by {row.createdBy?.name ?? "—"}</p></li>; })}</ol>}</section>
    </>}
    </div></main>{transitionOpen && transitionStudent && <StudentTransitionDialog open={transitionOpen} student={transitionStudent} batches={batches} batchesLoading={batchesLoading} batchesError={batchError} onClose={() => setTransitionOpen(false)} onSuccess={refreshAfterTransition}/>}<style jsx global>{`.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #dbe1ea;border-radius:.75rem;padding:.6rem .8rem;font-size:.875rem;font-weight:700}.btn:hover{background:#eff6ff}`}</style></div>;
}

export default function Page() { return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><Detail/></AuthGate>; }
