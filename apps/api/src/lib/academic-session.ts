import { AppError } from "./http.js";
import { prisma } from "./prisma.js";

export async function resolveAcademicSession(name: string) {
  const session = await prisma.academicSession.findFirst({
    where: { name: { equals: name.trim(), mode: "insensitive" } },
    select: { id: true, name: true, isArchived: true },
  });
  if (!session) throw new AppError(422, "INVALID_ACADEMIC_SESSION", "Select a valid academic session");
  if (session.isArchived) throw new AppError(409, "ACADEMIC_SESSION_ARCHIVED", "Archived academic sessions cannot receive new records");
  return { academicSessionId: session.id, academicSession: session.name };
}
