"use client";
import { useParams } from "next/navigation";
import { AuthGate } from "../../../../../components/auth-provider";
import CourseForm from "../../../../../components/course-form";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><CourseForm courseId={id} /></AuthGate>;
}
