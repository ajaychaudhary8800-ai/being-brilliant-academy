import { AppError } from "./http.js";

/**
 * A metered room can be closed locally only after positive LiveKit evidence:
 * either a successful DeleteRoom or a successful, strictly validated ListRooms
 * response confirming the exact room is absent.
 *
 * A lost DeleteRoom response may mean deletion already happened. Requiring an
 * unambiguous current provider-state check avoids indefinite retry loops while
 * never mistaking a network failure for proof that a paid room ended.
 */
export async function requireSchoolOSPrepaidRoomDisconnect(
 roomName: string,
 disconnectProvider: () => Promise<unknown>,
 listProviderRooms: () => Promise<unknown>,
): Promise<"DELETED" | "CONFIRMED_ABSENT"> {
 if(typeof roomName!=="string" || !roomName.trim())
  throw new AppError(422,"SCHOOLOS_VIDEO_ROOM_NAME_REQUIRED","A uniquely identified video room is required");
 try {
  await disconnectProvider();
  return "DELETED";
 } catch {
  // Provider DeleteRoom may have completed before a lost response; only a
  // successful authoritative room-list result can settle that ambiguity.
  try {
   const value=await listProviderRooms();
   if(value && typeof value==="object" && "rooms" in value &&
      Array.isArray(value.rooms) &&
      value.rooms.every((r:unknown)=>r!==null&&typeof r==="object" &&
       "name" in r&&typeof r.name==="string") &&
      !value.rooms.some((r:{name:string})=>r.name===roomName)){
    return "CONFIRMED_ABSENT";
   }
  } catch {
   // Provider unavailability/permission failures remain ambiguous.
  }
  throw new AppError(503,"SCHOOLOS_VIDEO_PROVIDER_END_UNCONFIRMED",
   "Live video room termination could not be verified. The room remains open for retry and provider reconciliation.");
 }
}
