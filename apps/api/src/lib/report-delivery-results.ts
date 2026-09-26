export type RecipientDeliveryResult = {
  recipient: string;
  status: "SENT" | "FAILED";
  messageId?: string;
  error?: string;
};

export type DeliveryStatus = "SENT" | "PARTIAL" | "FAILED";

export function summarizeDelivery(results: RecipientDeliveryResult[]): DeliveryStatus {
  const sent = results.filter(result => result.status === "SENT").length;
  if (results.length > 0 && sent === results.length) return "SENT";
  if (sent > 0) return "PARTIAL";
  return "FAILED";
}

export function retryRecipients(metadata: unknown, fallback: string[]): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [...new Set(fallback)];
  const value = metadata as { status?: unknown; recipientResults?: unknown };
  if (Array.isArray(value.recipientResults)) {
    const failed = value.recipientResults
      .filter((item): item is { recipient: string; status: string } =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as { recipient?: unknown }).recipient === "string" &&
        (item as { status?: unknown }).status === "FAILED")
      .map(item => item.recipient.trim())
      .filter(Boolean);
    return [...new Set(failed)];
  }
  return value.status === "FAILED" ? [...new Set(fallback)] : [];
}
