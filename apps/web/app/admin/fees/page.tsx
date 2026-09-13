"use client";

import { AdminWorkspace } from "../../../components/admin-workspace";
import { AuthGate } from "../../../components/auth-provider";
import { FinanceWorkspace } from "../../../components/finance-workspace";

export default function FeesPage() {
  return <AuthGate roles={["SUPER_ADMIN","BRANCH_ADMIN","ACCOUNTANT"]}><AdminWorkspace title="Fees & Finance Operations" description="Authoritative Fee Plans, student assignments, receivables, collections, refunds, reversals and reporting."><FinanceWorkspace/></AdminWorkspace></AuthGate>;
}
