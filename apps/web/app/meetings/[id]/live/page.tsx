"use client";
import { useParams } from "next/navigation";
import { AuthGate } from "../../../../components/auth-provider";
import { NativeMeetingRoom } from "../../../../components/native-meeting-room";

export default function Page(){
  const params=useParams<{id:string}>(); const id=typeof params?.id==="string"?params.id:"";
  return <AuthGate roles={["SUPER_ADMIN","BRANCH_ADMIN","ACCOUNTANT","TEACHER","EMPLOYEE"]}>{id?<NativeMeetingRoom meetingId={id}/>:<div className="grid min-h-screen place-items-center">Invalid meeting.</div>}</AuthGate>;
}
