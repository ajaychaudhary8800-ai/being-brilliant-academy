"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Contrast, Download, Home, LayoutDashboard, Search } from "lucide-react";

type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

export function PwaShell() {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [workerFailed, setWorkerFailed] = useState(false);

  useEffect(() => {
    const prompted = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    const installed = () => setInstall(null);

    window.addEventListener("beforeinstallprompt", prompted);
    window.addEventListener("appinstalled", installed);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => setWorkerFailed(true));
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", prompted);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  return <>
    {workerFailed && <p role="status" className="fixed bottom-20 left-4 right-4 z-40 mx-auto max-w-md rounded-xl bg-amber-50 p-3 text-center text-xs text-amber-900 shadow-lg">Offline installation is temporarily unavailable. The website remains available online.</p>}
    {install && <aside className="install-banner fixed bottom-20 left-4 right-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-slate-950 p-4 text-sm text-white shadow-2xl">
      <Download />
      <span className="flex-1"><b className="block">Install Being Brilliant</b>Learn faster, even offline.</span>
      <button onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }} className="rounded-lg bg-white px-3 py-2 font-bold text-slate-950">Install App</button>
    </aside>}
    <nav className="pwa-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-xl backdrop-blur md:hidden" aria-label="Mobile navigation">
      <Nav href="/" label="Home"><Home /></Nav>
      <Nav href="/courses" label="Courses"><Search /></Nav>
      <Nav href="/learning-hub" label="Learn"><BookOpen /></Nav>
      <Nav href="/dashboard" label="Dashboard"><LayoutDashboard /></Nav>
      <button onClick={() => document.documentElement.classList.toggle("high-contrast")} className="grid min-h-16 place-items-center text-[10px] font-bold" aria-label="Toggle high contrast"><Contrast size={20} /><span>Contrast</span></button>
    </nav>
  </>;
}

function Nav({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return <Link href={href} className="grid min-h-16 place-items-center text-[10px] font-bold" aria-label={label}>{children}<span>{label}</span></Link>;
}
