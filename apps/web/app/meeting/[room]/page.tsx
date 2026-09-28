"use client";
import { useParams } from "next/navigation";
import { AuthGate } from "../../../components/auth-provider";
import { NativeMeetingRoom } from "../../../components/native-meeting-room";
export default function Page(){const params=useParams<{room:string}>();const room=typeof params?.room==="string"?params.room:"";return <AuthGate roles={["SUPER_ADMIN","BRANCH_ADMIN","ACCOUNTANT","TEACHER","EMPLOYEE"]}>{room?<NativeMeetingRoom roomName={room}/>:<div className="grid min-h-screen place-items-center">Invalid meeting room.</div>}</AuthGate>}
