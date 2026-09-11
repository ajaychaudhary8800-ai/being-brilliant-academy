import { formatInstitutionDateTime, type InstitutionRegionalSettings } from "./institution-time";

export type CommunicationRow = Record<string, any>;
export type CommunicationField = { label: string; value: string };

const text = (value: unknown, fallback = "—") => typeof value === "string" && value.trim() ? value : fallback;
const role = (value: unknown) => text(value).replaceAll("_", " ");
const person = (value: any) => value?.name ? `${value.name} · ${role(value.role)}` : "—";
const audience = (value: unknown) => value ? role(value) : "Everyone";
const branch = (value: any) => value?.branchName ?? value?.name ?? "All branches";
const batch = (value: any) => value?.name ?? "All batches";
const dateTime = (value: unknown, settings: InstitutionRegionalSettings) => typeof value === "string" ? formatInstitutionDateTime(value, settings) : "—";
const lifecycle = (publishedAt: unknown, expiresAt: unknown) => {
  const now = Date.now(), published = typeof publishedAt === "string" ? new Date(publishedAt).getTime() : 0, expires = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : 0;
  return published > now ? "Scheduled" : expires && expires < now ? "Expired" : "Published";
};

export function communicationFields(tab: string, row: CommunicationRow, settings: InstitutionRegionalSettings): CommunicationField[] {
  switch (tab) {
    case "announcements":
      return [
        { label: "Announcement", value: text(row.title) },
        { label: "Audience", value: audience(row.audience) },
        { label: "Target", value: `${branch(row.branch)} · ${batch(row.batch)}` },
        { label: "Author", value: text(row.author?.name) },
        { label: "Published", value: dateTime(row.publishedAt, settings) },
        { label: "Status", value: lifecycle(row.publishedAt, row.expiresAt) },
      ];
    case "notifications":
      return [
        { label: "Notification", value: text(row.title) },
        { label: "Category", value: text(row.category) },
        { label: "Priority", value: text(row.priority) },
        { label: "Status", value: row.readAt ? "Read" : "Unread" },
        { label: "Created", value: dateTime(row.createdAt, settings) },
      ];
    case "messages":
      return [
        { label: "Subject", value: text(row.subject) },
        { label: "From", value: person(row.sender) },
        { label: "To", value: person(row.recipient) },
        { label: "Status", value: row.readAt ? "Read" : "Unread" },
        { label: "Sent", value: dateTime(row.createdAt, settings) },
      ];
    case "circulars":
      return [
        { label: "Circular", value: `${text(row.number)} · ${text(row.title)}` },
        { label: "Audience", value: audience(row.audience) },
        { label: "Branch", value: branch(row.branch) },
        { label: "Engagement", value: `${row._count?.acknowledgements ?? 0} acknowledgements · ${row._count?.downloads ?? 0} downloads` },
        { label: "Published", value: dateTime(row.publishedAt, settings) },
        { label: "Status", value: lifecycle(row.publishedAt, row.expiresAt) },
      ];
    case "events":
      return [
        { label: "Event", value: text(row.title) },
        { label: "Type / Status", value: `${text(row.type)} · ${text(row.status)}` },
        { label: "Target", value: `${branch(row.branch)} · ${batch(row.batch)}` },
        { label: "Starts", value: dateTime(row.startsAt, settings) },
        { label: "Ends", value: dateTime(row.endsAt, settings) },
      ];
    default:
      return [];
  }
}
