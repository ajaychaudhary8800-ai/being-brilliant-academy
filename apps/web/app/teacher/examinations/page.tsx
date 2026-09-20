"use client";

import { AuthGate } from "../../../components/auth-provider";
import { ExaminationWorkflowContent } from "../../../components/examination-workflow";

export default function Page() {
  return <AuthGate roles={["TEACHER"]}><ExaminationWorkflowContent teacherView/></AuthGate>;
}
