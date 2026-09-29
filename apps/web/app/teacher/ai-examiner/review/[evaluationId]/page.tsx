"use client";

import { useParams } from "next/navigation";
import { AuthGate } from "../../../../../components/auth-provider";
import { AIExaminerReview } from "../../../../../components/ai-examiner-review";

export default function Page(){
  const params=useParams<{evaluationId:string}>();
  return <AuthGate roles={["TEACHER"]}><AIExaminerReview evaluationId={params.evaluationId} teacherView/></AuthGate>;
}
