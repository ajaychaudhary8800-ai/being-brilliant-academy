"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import BatchForm from "../../../../../components/batch-form";
import { AuthGate, getAccessToken } from "../../../../../components/auth-provider";
import Sidebar from "../../../../../components/sidebar";
import { useGroupTerminology } from "../../../../../components/use-group-terminology";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type Batch = { id: string; name: string; code: string; academicSession: string; startsAt: string; endsAt: string | null; capacity: number; timing: string; days: string[]; classroom: string | null; feesPaise: number; status: string; remarks: string | null; branch: { id: string }; course: { id: string } | null; teacher: { id: string } | null };
function Content() { const { id } = useParams<{ id: string }>(), terms = useGroupTerminology(), [batch, setBatch] = useState<Batch | null>(null), [error, setError] = useState(""); useEffect(() => { fetch(`${api}/admin/batches/${id}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } }).then(async response => { const json = await response.json(); if (!response.ok) throw Error(json?.error?.message ?? `Unable to load ${terms.singular.toLowerCase()}`); setBatch(json.data); }).catch(cause => setError(cause instanceof Error ? cause.message : `Unable to load ${terms.singular.toLowerCase()}`)); }, [id, terms.singular]); return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><Sidebar/><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-5xl"><h1 className="text-3xl font-bold">Edit {terms.singular}</h1>{error ? <p className="mt-5 rounded-xl bg-red-50 p-4 text-red-700">{error}</p> : batch ? <BatchForm batch={batch}/> : <p className="mt-6">Loading {terms.singular.toLowerCase()}…</p>}</div></main></div>; }
export default function Page() { return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><Content/></AuthGate>; }
