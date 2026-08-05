"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const ACCESS_KEY = "bba.accessToken";
const REFRESH_KEY = "bba.refreshToken";
export type AppRole = "SUPER_ADMIN" | "BRANCH_ADMIN" | "TEACHER" | "STUDENT" | "PARENT" | "EMPLOYEE";
export type AuthPortal = "student" | "parent" | "teacher" | "admin";
export type AuthUser = { id: string; name: string; email: string; role: AppRole; organizationId: string };
type AuthResponse = { user: AuthUser; accessToken: string; refreshToken: string };
type AuthContextValue = { user: AuthUser | null; loading: boolean; login: (email: string, password: string, rememberMe: boolean, organization?: string, portal?: AuthPortal) => Promise<AuthUser>; register: (name: string, email: string, password: string, rememberMe: boolean) => Promise<AuthUser>; logout: () => Promise<void>; requestPasswordReset: (email: string, organization?: string) => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);
const targetStorage = (rememberMe: boolean) => rememberMe ? localStorage : sessionStorage;
const readRefreshToken = () => localStorage.getItem(REFRESH_KEY) ?? sessionStorage.getItem(REFRESH_KEY);
const clearTokens = () => [localStorage, sessionStorage].forEach((store) => { store.removeItem(ACCESS_KEY); store.removeItem(REFRESH_KEY); });
export const getAccessToken = () => localStorage.getItem(ACCESS_KEY) ?? sessionStorage.getItem(ACCESS_KEY);
export const errorMessage = (value: unknown) => value instanceof Error ? value.message : "Something went wrong. Please try again.";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const persist = useCallback((data: AuthResponse, rememberMe: boolean) => { clearTokens(); const store = targetStorage(rememberMe); store.setItem(ACCESS_KEY, data.accessToken); store.setItem(REFRESH_KEY, data.refreshToken); setUser(data.user); }, []);
  const authenticate = useCallback(async (path: "login" | "register", body: Record<string, unknown>) => { const response = await fetch(`${API_URL}/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const json = await response.json().catch(() => null); if (!response.ok) throw new Error(json?.error?.message ?? "Unable to sign in"); const data = json.data as AuthResponse; persist(data, Boolean(body.rememberMe)); return data.user; }, [persist]);
  const refresh = useCallback(async () => { const refreshToken = readRefreshToken(); if (!refreshToken) return null; try { const response = await fetch(`${API_URL}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) }); const json = await response.json().catch(() => null); if (!response.ok) { clearTokens(); return null; } const data = json.data as { accessToken: string; refreshToken: string }; const store = targetStorage(Boolean(localStorage.getItem(REFRESH_KEY))); clearTokens(); store.setItem(ACCESS_KEY, data.accessToken); store.setItem(REFRESH_KEY, data.refreshToken); const me = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${data.accessToken}` } }); const meJson = await me.json().catch(() => null); if (!me.ok) { clearTokens(); return null; } setUser(meJson.data as AuthUser); return meJson.data as AuthUser; } catch { clearTokens(); return null; } }, []);
  useEffect(() => { void refresh().finally(() => setLoading(false)); }, [refresh]);
  const logout = useCallback(async () => { const refreshToken = readRefreshToken(); try { if (refreshToken) await fetch(`${API_URL}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) }); } finally { clearTokens(); setUser(null); } }, []);
  const requestPasswordReset = useCallback(async (email: string, organization = "being-brilliant-academy") => { const response = await fetch(`${API_URL}/auth/forgot-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, organization }) }); if (!response.ok) { const json = await response.json().catch(() => null); throw new Error(json?.error?.message ?? "Unable to request a password reset"); } }, []);
  const value = useMemo(() => ({ user, loading, login: (email: string, password: string, rememberMe: boolean, organization = "being-brilliant-academy", portal?: AuthPortal) => authenticate("login", { email, password, rememberMe, organization, portal }), register: (name: string, email: string, password: string, rememberMe: boolean) => authenticate("register", { name, email, password, rememberMe, organization: "being-brilliant-academy" }), logout, requestPasswordReset }), [user, loading, authenticate, logout, requestPasswordReset]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error("useAuth must be used inside AuthProvider"); return context; }
export function AuthGate({ children, roles }: { children: React.ReactNode; roles?: AppRole[] }) { const { user, loading } = useAuth(); const router = useRouter(); const pathname = usePathname(); const roleKey = roles?.join(",") ?? ""; useEffect(() => { if (!loading && (!user || (roles && !roles.includes(user.role)))) router.replace(!user ? `/login?next=${encodeURIComponent(pathname)}` : "/dashboard"); }, [loading, user, roleKey, router, pathname, roles]); if (loading || !user || (roles && !roles.includes(user.role))) return <main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-950">Loading your secure workspace…</main>; return <>{children}</>; }
