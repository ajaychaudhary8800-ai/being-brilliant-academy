"use client";

import { useParams } from "next/navigation";
import { AuthGate } from "../../../../../components/auth-provider";
import { AIExaminerReview } from "../../../../../components/ai-examiner-review";

export default function Page(){
  const params=useParams<{evaluationId:string}>();
  return <AuthGate roles={["SUPER_ADMIN","BRANCH_ADMIN"]}><AIExaminerReview evaluationId={params.evaluationId}/></AuthGate>;
}
