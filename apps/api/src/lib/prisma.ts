import { PrismaClient } from "@prisma/client";
import { AppError } from "./http.js";
import { currentTenant } from "./tenant-context.js";

export const systemPrisma = new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
const unscoped = new Set(["Organization", "TenantAccessAudit"]);
const sessionModels = new Set(["Batch", "StudentProfile", "Examination", "Timetable"]);
export const tenantWhere = (organizationId: string, where: Record<string, unknown> = {}) => ({ ...where, organizationId });

async function withAcademicSession(model: string | undefined, organizationId: string, data: any, scalar = false) {
  if (!sessionModels.has(model ?? "") || !data?.academicSession) return data;
  const session = await systemPrisma.academicSession.findFirst({ where: { organizationId, name: { equals: String(data.academicSession).trim(), mode: "insensitive" } }, select: { id: true, name: true, isArchived: true } });
  if (!session) throw new AppError(422, "INVALID_ACADEMIC_SESSION", "Select a valid academic session");
  if (session.isArchived) throw new AppError(409, "ACADEMIC_SESSION_ARCHIVED", "Archived academic sessions cannot receive new records");
  return scalar || "branchId" in data ? { ...data, academicSession: session.name, academicSessionId: session.id } : { ...data, academicSession: session.name, session: { connect: { id: session.id } } };
}

export const prisma = systemPrisma.$extends({ name: "organization-isolation", query: { $allModels: { async $allOperations({ model, operation, args, query }) {
  const tenant = currentTenant(); if (!tenant || unscoped.has(model)) return query(args); const a = args as any, where = tenantWhere(tenant.organizationId, a.where);
  if (["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany"].includes(operation)) return query({ ...a, where });
  if (["findUnique", "findUniqueOrThrow", "delete"].includes(operation)) return query({ ...a, where });
  if (operation === "update") return query({ ...a, where });
  if (operation === "create") return query({ ...a, data: { ...await withAcademicSession(model, tenant.organizationId, a.data), organizationId: tenant.organizationId } });
  if (operation === "createMany" || operation === "createManyAndReturn") { const rows = Array.isArray(a.data) ? a.data : [a.data]; return query({ ...a, data: await Promise.all(rows.map(async (row: any) => ({ ...await withAcademicSession(model, tenant.organizationId, row, true), organizationId: tenant.organizationId }))) }); }
  if (operation === "upsert") return query({ ...a, where, create: { ...await withAcademicSession(model, tenant.organizationId, a.create), organizationId: tenant.organizationId }, update: await withAcademicSession(model, tenant.organizationId, a.update, true) });
  return query(a);
} } } }) as unknown as PrismaClient;
