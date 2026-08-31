"use client";

import BatchForm from "../../../../components/batch-form";
import { AuthGate } from "../../../../components/auth-provider";
import Sidebar from "../../../../components/sidebar";
import { useGroupTerminology } from "../../../../components/use-group-terminology";

function Content() { const terms = useGroupTerminology(); return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><Sidebar/><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-5xl"><h1 className="text-3xl font-bold">{terms.add}</h1><BatchForm/></div></main></div>; }
export default function Page() { return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><Content/></AuthGate>; }
