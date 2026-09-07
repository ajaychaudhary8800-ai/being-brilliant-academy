export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: string | null;
  branches: Array<{ branchName: string; branchCode: string }>;
  linkedProfile: string | null;
  parentChildren: Array<{ id: string; name: string; admissionNo: string; relationship: string; branch: string; batch: string | null }>;
};

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value : fallback;

export function normalizeAdminUsersResponse(payload: unknown) {
  const root = object(payload);
  const rows = Array.isArray(root.data) ? root.data : [];
  const meta = object(root.meta);
  const data: AdminUserRow[] = rows.flatMap(value => {
    const user = object(value);
    const id = text(user.id);
    if (!id) return [];
    const branches = (Array.isArray(user.branches) ? user.branches : []).flatMap(value => {
      const branch = object(value);
      const branchName = text(branch.branchName);
      return branchName ? [{ branchName, branchCode: text(branch.branchCode) }] : [];
    });
    const parentChildren = (Array.isArray(user.parentChildren) ? user.parentChildren : []).flatMap(value => {
      const child = object(value); const childId = text(child.id);
      return childId ? [{ id: childId, name: text(child.name, "Unknown student"), admissionNo: text(child.admissionNo, "—"), relationship: text(child.relationship, "Parent"), branch: text(child.branch, "Unassigned"), batch: text(child.batch) || null }] : [];
    });
    return [{ id, name: text(user.name, "Unnamed user"), email: text(user.email, "—"), phone: text(user.phone) || null, role: text(user.role, "UNKNOWN"), isActive: user.isActive === true, createdAt: text(user.createdAt) || null, branches, linkedProfile: text(user.linkedProfile) || null, parentChildren }];
  });
  const total = typeof meta.total === "number" && Number.isFinite(meta.total) ? meta.total : data.length;
  const totalPages = typeof meta.totalPages === "number" && Number.isFinite(meta.totalPages) && meta.totalPages > 0 ? meta.totalPages : 1;
  return { data, meta: { total, totalPages } };
}

export function formatAdminUserDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}
