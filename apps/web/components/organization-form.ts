export const organizationCreationCopy = {
  heading: "Add New Organization",
  submit: "Create Organization",
} as const;

export const defaultOrganizationTimezone = "Asia/Kolkata";

export const organizationGroupTerminologyOptions = [
  ["SECTION", "Section"],
  ["BATCH", "Batch"],
  ["GROUP", "Group"],
  ["CUSTOM", "Custom label"],
] as const;

export function organizationSlug(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function organizationNameUpdate(current: { name: string; slug: string }, name: string, slugEdited: boolean, editing: boolean) {
  return { ...current, name, ...(!slugEdited && !editing ? { slug: organizationSlug(name) } : {}) };
}
