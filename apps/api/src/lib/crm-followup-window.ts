export const CRM_FOLLOW_UP_UPCOMING_HOURS = 24;

export function enquiryFollowUpWindow(reminder: "due" | "upcoming", now = new Date()) {
  if (reminder === "due") return { lt: now };
  return { gte: now, lte: new Date(now.getTime() + CRM_FOLLOW_UP_UPCOMING_HOURS * 60 * 60 * 1000) };
}
