"use client";

import { AuthGate } from "../../../components/auth-provider";
import { AIExaminerFoundationContent } from "../../../components/ai-examiner-foundation";

export default function Page() {
  return <AuthGate roles={["TEACHER"]}><AIExaminerFoundationContent teacherView /></AuthGate>;
}
