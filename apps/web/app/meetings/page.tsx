"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, ListTodo, Loader2, Plus, Radio, UsersRound } from "lucide-react";
import { AuthGate, errorMessage, getAccessToken, useAuth } from "../../components/auth-provider";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type Dashboard = { today: number; upcoming: number; live: number; pendingMinutes: number; myActions: number; overdueActions: number };
type Meeting = {
  id: string; title: string; description?: string | null; type: string; startsAt: string; endsAt: string; timezone: string;
  status: string; branchId?: string | null; departmentId?: string | null;
  _count: { participants: number; actionItems: number; recordings: number };
  participants?: Array<{ meetingRole: string; responseStatus: string }>;
};
type Action = { id: string; title: string; status: string; priority: string; dueAt?: string | null; overdue: boolean; meeting: { id: string; title: string } };

async function api(path: string) {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "Request failed");
  return body;
}
const pretty = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, x => x.toUpperCase());
const dateTime = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const portalHome = (role?: string) => role === "TEACHER" ? "/teacher" : role === "EMPLOYEE" ? "/employee" : "/admin";

function Content() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [dash, rows, myActions] = await Promise.all([
        api("/meetings/dashboard"),
        api(`/meetings?limit=50${status ? `&status=${encodeURIComponent(status)}` : ""}`),
        api("/meeting-actions/my"),
      ]);
      setDashboard(dash.data); setMeetings(rows.data ?? []); setActions(myActions.data ?? []);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const canCreate = ["SUPER_ADMIN","BRANCH_ADMIN","TEACHER","EMPLOYEE"].includes(user?.role ?? "");
  return <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
    <div className="container-page py-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={portalHome(user?.role)} className="text-sm font-bold text-brand-700">← Back to portal</Link>
          <p className="mt-4 text-xs font-black uppercase tracking-wider text-brand-700">Enterprise collaboration</p>
          <h1 className="mt-1 text-3xl font-black">Staff & Management Meetings</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">Organization, branch and department meetings with native video, attendance, minutes, decisions and accountable action items.</p>
        </div>
        {canCreate && <Link href="/meetings/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-3 font-bold text-white"><Plus size={17}/>Schedule meeting</Link>}
      </header>

      {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {loading ? <div className="grid min-h-72 place-items-center"><Loader2 className="animate-spin text-brand-700"/></div> : <>
        <section className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {[
            [CalendarDays,"Today",dashboard?.today ?? 0],
            [Clock3,"Upcoming",dashboard?.upcoming ?? 0],
            [Radio,"Live",dashboard?.live ?? 0],
            [UsersRound,"Minutes pending",dashboard?.pendingMinutes ?? 0],
            [ListTodo,"My actions",dashboard?.myActions ?? 0],
            [CheckCircle2,"Overdue actions",dashboard?.overdueActions ?? 0],
          ].map(([Icon,label,value]) => { const I=Icon as typeof CalendarDays; return <article key={String(label)} className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><I size={19} className="text-brand-700"/><p className="mt-3 text-xs font-bold uppercase text-slate-400">{String(label)}</p><p className="mt-1 text-2xl font-black">{String(value)}</p></article>; })}
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-xl font-black">Meeting calendar</h2><p className="text-sm text-slate-500">Your authorized meeting scope only.</p></div>
            <select value={status} onChange={event=>setStatus(event.target.value)} className="rounded-xl border bg-white px-3 py-2 text-sm dark:bg-slate-900">
              <option value="">All statuses</option>{["SCHEDULED","OPEN_FOR_JOIN","LIVE","MINUTES_PENDING","MINUTES_PUBLISHED","CLOSED","CANCELLED"].map(x=><option key={x}>{x}</option>)}
            </select>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {meetings.map(meeting => <Link key={meeting.id} href={`/meetings/${meeting.id}`} className="rounded-2xl border bg-white p-5 transition hover:border-brand-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-brand-700">{pretty(meeting.type)}</p><h3 className="mt-1 text-lg font-black">{meeting.title}</h3></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meeting.status==="LIVE"?"bg-red-100 text-red-700":meeting.status==="CANCELLED"?"bg-slate-200 text-slate-600":"bg-blue-50 text-blue-700"}`}>{pretty(meeting.status)}</span></div>
              <p className="mt-3 text-sm text-slate-500">{dateTime(meeting.startsAt)} · {Math.max(1,Math.round((new Date(meeting.endsAt).getTime()-new Date(meeting.startsAt).getTime())/60000))} min</p>
              <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500"><span>{meeting._count.participants} participants</span><span>{meeting._count.actionItems} actions</span><span>{meeting._count.recordings} recordings</span>{meeting.participants?.[0]&&<span>{pretty(meeting.participants[0].meetingRole)} · {pretty(meeting.participants[0].responseStatus)}</span>}</div>
            </Link>)}
            {!meetings.length && <div className="rounded-2xl border border-dashed bg-white p-10 text-center text-slate-500 dark:bg-slate-900">No meetings match this view.</div>}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-black">My action items</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border bg-white dark:border-slate-800 dark:bg-slate-900">
            {actions.slice(0,10).map(action=><Link key={action.id} href={`/meetings/${action.meeting.id}`} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 text-sm last:border-b-0 dark:border-slate-800"><div><b>{action.title}</b><p className="text-xs text-slate-500">{action.meeting.title}</p></div><div className="text-right"><span className={`rounded-full px-2 py-1 text-xs font-bold ${action.overdue?"bg-red-100 text-red-700":"bg-slate-100 text-slate-700"}`}>{action.overdue?"Overdue":pretty(action.status)}</span>{action.dueAt&&<p className="mt-1 text-xs text-slate-400">Due {dateTime(action.dueAt)}</p>}</div></Link>)}
            {!actions.length && <p className="p-6 text-sm text-slate-500">No open meeting actions assigned to you.</p>}
          </div>
        </section>
      </>}
    </div>
  </main>;
}

export default function Page() {
  return <AuthGate roles={["SUPER_ADMIN","BRANCH_ADMIN","ACCOUNTANT","TEACHER","EMPLOYEE"]}><Content/></AuthGate>;
}
