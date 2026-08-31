"use client";
import { AuthGate } from "../../../../components/auth-provider";
import CourseForm from "../../../../components/course-form";

export default function Page() {
  return <AuthGate roles={["SUPER_ADMIN", "BRANCH_ADMIN"]}><CourseForm /></AuthGate>;
}
