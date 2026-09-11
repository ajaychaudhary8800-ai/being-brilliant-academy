"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Loader2, Pencil } from "lucide-react";
import { AuthGate, getAccessToken } from "../../../../components/auth-provider";
import Sidebar from "../../../../components/sidebar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Course = {
  id: string; title: string; courseCode: string; slug: string; fullDescription: string; shortDescription: string | null;
  categoryType: string | null; classLevel: string | null; academicBoard: string | null; academicStream: string | null;
  language: string; mode: string; status: string; regularPricePaise: number; salePricePaise: number | null;
  branch: { branchName: string } | null; subjects: Array<{ isActive: boolean; subject: { id: string; name: string; code: string; status: string } }>;
  _count: { enrollments: number; batches: number; modules: number };
};

function Content() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course | null>(null), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(), token = getAccessToken(); fetch(`${API}/admin/courses/${id}`, { signal: controller.signal, headers: { Authorization: `Bearer ${token ?? ""}` } }).then(async response => { const body = await response.json().catch(() => null); if (!response.ok) { const fallback = response.status === 401 ? "Your session has expired. Sign in again." : response.status === 403 ? "You do not have access to this course." : response.status === 404 ? "Course not found." : "Unable to open course"; throw new Error(body?.error?.message ?? fallback); } setCourse(body.data); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to open course"); }); return () => controller.abort(); }, [id]);
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><Sidebar/><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-5xl"><Link href="/admin/courses" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700"><ArrowLeft size={17}/>Back to courses</Link>{error ? <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p> : !course ? <div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin text-brand-700"/></div> : <><header className="mt-6 flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-bold text-brand-700">{course.courseCode}</p><h1 className="text-3xl font-bold">{course.title}</h1><p className="mt-1 text-sm text-slate-500">{course.branch?.branchName ?? "All branches"} · {course.status.replaceAll("_", " ")}</p></div><Link href={`/admin/courses/${course.id}/edit`} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-3 text-sm font-bold text-white"><Pencil size={17}/>Edit Course</Link></header><section className="mt-6 grid gap-4 sm:grid-cols-3">{[["Category", course.categoryType], ["Class", course.classLevel], ["Board", course.academicBoard], ["Stream", course.academicStream], ["Language", course.language], ["Mode", course.mode], ["Price", `₹${((course.salePricePaise ?? course.regularPricePaise) / 100).toLocaleString("en-IN")}`], ["Batches", course._count.batches], ["Enrollments", course._count.enrollments]].map(([label, value]) => <div className="rounded-xl border bg-white p-4 dark:bg-slate-900" key={String(label)}><small className="uppercase text-slate-400">{label}</small><p className="mt-1 font-bold">{value == null ? "—" : String(value).replaceAll("_", " ")}</p></div>)}</section><section className="mt-5 rounded-2xl border bg-white p-6 dark:bg-slate-900"><h2 className="text-xl font-bold">Course description</h2>{course.shortDescription && <p className="mt-3 font-semibold">{course.shortDescription}</p>}<p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{course.fullDescription}</p></section><section className="mt-5 rounded-2xl border bg-white p-6 dark:bg-slate-900"><h2 className="flex items-center gap-2 text-xl font-bold"><BookOpen size={20}/>Subject Master associations</h2><div className="mt-4 flex flex-wrap gap-2">{course.subjects.length ? course.subjects.map(row => <span key={row.subject.id} className={`rounded-full border px-3 py-1 text-sm ${row.isActive && row.subject.status === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{row.subject.name} ({row.subject.code}){row.isActive ? "" : " · inactive mapping"}</span>) : <p className="text-sm text-slate-500">No subjects associated.</p>}</div></section></>}</div></main></div>;
}

export default function Page() { return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><Content/></AuthGate>; }
