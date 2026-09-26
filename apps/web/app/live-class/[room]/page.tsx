"use client";

import { useParams } from "next/navigation";
import { AuthGate } from "../../../components/auth-provider";
import { NativeLiveClassroom } from "../../../components/native-live-classroom";

export default function Page() {
  const params = useParams<{ room: string }>();
  const room = typeof params?.room === "string" ? params.room : "";
  return <AuthGate roles={["SUPER_ADMIN","BRANCH_ADMIN","TEACHER","STUDENT","PARENT"]}>
    {room ? <NativeLiveClassroom roomName={room}/> : <div className="grid min-h-screen place-items-center">Invalid classroom.</div>}
  </AuthGate>;
}
