"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate, useAuth } from "../../components/auth-provider";
function RouteDashboard(){const {user}=useAuth();const router=useRouter();useEffect(()=>{if(!user)return;router.replace(user.role==="PARENT"?"/parent":user.role==="STUDENT"?"/student":user.role==="TEACHER"?"/teacher":user.role==="EMPLOYEE"?"/employee":"/admin");},[user,router]);return <main className="grid min-h-screen place-items-center text-sm text-slate-500">Opening your workspace…</main>}
export default function Dashboard(){return <AuthGate><RouteDashboard/></AuthGate>}
