import { AppError } from "./http.js";

/**
 * Video-finance safety boundary: do not mark a prepaid LiveKit meeting ended
 * until the provider has positively confirmed room termination.
 *
 * A failed/ambiguous DeleteRoom result is *not* an indication of no usage.
 * The meeting must stay in an active status so the expiration worker can
 * retry; the prepaid reservation remains held for signed-event settlement.
 */
export async function requireSchoolOSPrepaidRoomDisconnect(
 disconnectProvider: () => Promise<unknown>,
): Promise<void> {
 try {
  await disconnectProvider();
 } catch {
  throw new AppError(
   503,
   "SCHOOLOS_VIDEO_PROVIDER_END_UNCONFIRMED",
   "Live video room termination could not be verified. The room remains open for retry and provider reconciliation.",
  );
 }
}
