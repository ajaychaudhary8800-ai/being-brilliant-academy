"use client";

import { LogOut, RefreshCw } from "lucide-react";
import { AuthGate, useAuth } from "./auth-provider";
import Sidebar from "./sidebar";

type AdminWorkspaceProps = {
  title: string;
  description: string;
  children?: React.ReactNode;
};

export function AdminWorkspace({ title, description, children }: AdminWorkspaceProps) {
  const { logout } = useAuth();
  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><Sidebar/><main className="min-h-screen p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-7xl"><header className="flex flex-col gap-4 border-b border-slate-200 pb-6 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-semibold text-brand-700">ACADEMY OPERATIONS</p><h1 className="mt-1 text-3xl font-bold tracking-tight">{title}</h1><p className="mt-2 text-sm text-slate-500">{description}</p></div><button onClick={() => void logout()} className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><LogOut size={16}/>Log out</button></header>{children ?? <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><RefreshCw size={19}/></span><div><h2 className="font-bold">Operations workspace</h2><p className="mt-1 text-sm text-slate-500">Use the controls in this section to manage academy records.</p></div></div></section>}</div></main></div>;
}

export function ProtectedAdminWorkspace(props: AdminWorkspaceProps) {
  return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><AdminWorkspace {...props}/></AuthGate>;
}
