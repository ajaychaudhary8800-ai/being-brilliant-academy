"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Contrast, Download, Home, LayoutDashboard, X } from "lucide-react";
import { useTenantBranding } from "./tenant-branding";
import { useAuth } from "./auth-provider";

type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

export function PwaShell() {
  const { brand } = useTenantBranding();
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [workerFailed, setWorkerFailed] = useState(false);

  useEffect(() => {
    if (loading || !user) return;

    const prompted = (event: Event) => {
      event.preventDefault();
      if (Number(window.localStorage.getItem("bba-pwa-install-dismissed-until") ?? "0") > Date.now()) return;
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
  }, [loading, user]);

  if (loading || !user || pathname?.startsWith("/live-class/")) return null;

  const portalHref =
    user.role === "STUDENT" ? "/student" :
    user.role === "PARENT" ? "/parent" :
    user.role === "TEACHER" ? "/teacher" :
    user.role === "EMPLOYEE" ? "/employee" :
    "/admin";

  return (
    <>
      {workerFailed && (
        <p role="status" className="fixed bottom-20 left-4 right-4 z-40 mx-auto max-w-md rounded-xl bg-amber-50 p-3 text-center text-xs text-amber-900 shadow-lg">
          Offline installation is temporarily unavailable. The workspace remains available online.
        </p>
      )}

      {install && (
        <aside className="install-banner fixed bottom-20 left-4 right-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-slate-950 p-4 text-sm text-white shadow-2xl">
          <Download />
          <span className="flex-1">
            <b className="block">Install {brand.appName}</b>
            Access your workspace faster, even offline.
          </span>
          <button
            onClick={async () => {
              await install.prompt();
              await install.userChoice;
              setInstall(null);
            }}
            className="rounded-lg bg-white px-3 py-2 font-bold text-slate-950"
          >
            Install App
          </button>
          <button
            type="button"
            aria-label="Dismiss install prompt"
            onClick={() => {
              window.localStorage.setItem("bba-pwa-install-dismissed-until", String(Date.now() + 7 * 24 * 60 * 60 * 1000));
              setInstall(null);
            }}
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white"
            title="Not now"
          >
            <X size={17}/>
          </button>
        </aside>
      )}

      <nav className="pwa-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-xl backdrop-blur md:hidden" aria-label="Workspace navigation">
        <Nav href="/dashboard" label="Dashboard"><LayoutDashboard /></Nav>
        <Nav href="/learning-hub" label="Learn"><BookOpen /></Nav>
        <Nav href={portalHref} label="Portal"><Home /></Nav>
        <button
          onClick={() => document.documentElement.classList.toggle("high-contrast")}
          className="grid min-h-16 place-items-center text-[10px] font-bold"
          aria-label="Toggle high contrast"
        >
          <Contrast size={20} />
          <span>Contrast</span>
        </button>
      </nav>
    </>
  );
}

function Nav({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="grid min-h-16 place-items-center text-[10px] font-bold" aria-label={label}>
      {children}
      <span>{label}</span>
    </Link>
  );
}
