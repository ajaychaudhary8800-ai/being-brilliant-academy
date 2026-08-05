"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  CreditCard,
  GraduationCap,
  LogOut,
  Users,
} from "lucide-react";

import {
  AuthGate,
  useAuth,
  getAccessToken,
} from "../../components/auth-provider";
import Sidebar from "../../components/sidebar";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000/api/v1";

function AdminContent() {
  const { logout } = useAuth();

  const [overview, setOverview] = useState<{
    students: number;
    courses: number;
    activeEnrollments: number;
    revenuePaise: number;
    totalBranches: number;
    activeBranches: number;
    inactiveBranches: number;
  } | null>(null);

  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    async function loadOverview() {
      try {
        const token = getAccessToken();

        const response = await fetch(
          `${API_URL}/admin/overview`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const json = await response.json();

        setOverview(json.data);
      } catch {
      } finally {
        setLoadingData(false);
      }
    }

    loadOverview();
  }, []);

  const cards = [
    {
      icon: Users,
      label: "Students",
      value: loadingData
        ? "Loading..."
        : String(overview?.students ?? 0),
    },
    {
      icon: GraduationCap,
      label: "Active Enrolments",
      value: loadingData
        ? "Loading..."
        : String(overview?.activeEnrollments ?? 0),
    },
    {
      icon: CreditCard,
      label: "Revenue",
      value: loadingData
        ? "Loading..."
        : `₹${((overview?.revenuePaise ?? 0) / 100).toLocaleString("en-IN")}`,
    },
    {
      icon: BarChart3,
      label: "Courses",
      value: loadingData
        ? "Loading..."
        : String(overview?.courses ?? 0),
    },
    {
      icon: Building2,
      label: "Total Branches",
      value: loadingData ? "Loading..." : String(overview?.totalBranches ?? 0),
    },
    {
      icon: Building2,
      label: "Active Branches",
      value: loadingData ? "Loading..." : String(overview?.activeBranches ?? 0),
    },
    {
      icon: Building2,
      label: "Inactive Branches",
      value: loadingData ? "Loading..." : String(overview?.inactiveBranches ?? 0),
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar />
    <main className="min-h-screen p-6 md:ml-64 md:p-10">
      <div className="mx-auto max-w-6xl">

        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold">
            Academy Overview
          </h1>

          <button
            onClick={() => void logout()}
            className="flex items-center gap-2 rounded border px-4 py-2"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;

            return (
              <div
                key={card.label}
                className="rounded-xl border bg-white p-6 shadow-sm"
              >
                <Icon
                  size={28}
                  className="mb-4 text-blue-600"
                />

                <p className="text-gray-500">
                  {card.label}
                </p>

                <h2 className="mt-2 text-3xl font-bold">
                  {card.value}
                </h2>
              </div>
            );
          })}
        </div>
      </div>
    </main>
    </div>
  );
}

export default function Admin() {
  return (
    <AuthGate
      roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}
    >
      <AdminContent />
    </AuthGate>
  );
}
