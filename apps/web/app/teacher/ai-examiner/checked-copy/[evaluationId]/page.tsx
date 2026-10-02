"use client";
import { useParams } from "next/navigation";
import { AuthGate } from "../../../../../components/auth-provider";
import { AIExaminerCheckedCopyEditor } from "../../../../../components/ai-examiner-checked-copy-editor";
export default function Page(){const params=useParams<{evaluationId:string}>();return <AuthGate roles={["TEACHER"]}><AIExaminerCheckedCopyEditor evaluationId={params.evaluationId} teacherView/></AuthGate>;}
