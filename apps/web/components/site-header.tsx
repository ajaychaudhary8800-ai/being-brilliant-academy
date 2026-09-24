"use client";

import Link from "next/link";
import { Menu, Moon, Sun, X } from "lucide-react";
import { useState } from "react";

const nav = [
  { href: "/#platform", label: "Platform" },
  { href: "/#modules", label: "Modules" },
  { href: "/#solutions", label: "Solutions" },
  { href: "/#white-label", label: "White-label" },
  { href: "/#pricing", label: "Pricing" },
];

export function SiteHeader() {
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);

  const toggleTheme = () => {
    document.documentElement.classList.toggle("dark");
    setDark((value) => !value);
  };

  return (
    <header className="site-header sticky top-0 z-50 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-3" onClick={() => setOpen(false)}>
          <span className="font-black tracking-tight text-brand-700">
            BEING <span className="text-orange-700 dark:text-orange-500">BRILLIANT</span>
          </span>
          <span className="hidden rounded-full border border-slate-200 px-2 py-1 text-[10px] font-black uppercase tracking-[.15em] text-slate-500 lg:inline-flex dark:border-slate-800">
            Education Platform
          </span>
        </Link>

        <nav className="hidden items-center gap-5 text-sm font-semibold lg:flex" aria-label="Primary navigation">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="transition hover:text-brand-700">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            aria-label="Toggle colour theme"
            className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <Link href="/login" className="hidden rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold sm:block dark:border-slate-700">
            Sign in
          </Link>
          <Link href="/#contact" className="hidden rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white sm:block">
            Book demo
          </Link>
          <button
            className="rounded-lg p-2 lg:hidden"
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-slate-200 bg-white px-5 py-4 lg:hidden dark:border-slate-800 dark:bg-slate-950" aria-label="Mobile navigation">
          <div className="container-page grid gap-1 px-0">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-3 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-900"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href="/login" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-4 py-3 text-center text-sm font-bold dark:border-slate-700">
                Sign in
              </Link>
              <Link href="/#contact" onClick={() => setOpen(false)} className="rounded-lg bg-brand-700 px-4 py-3 text-center text-sm font-bold text-white">
                Book demo
              </Link>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
