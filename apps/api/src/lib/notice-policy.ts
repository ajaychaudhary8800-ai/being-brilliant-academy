import { Role } from "@prisma/client";

export function noticeRecipientConstraints(role: Role, branchIds: string[] | null, batchIds: string[] | null, now = new Date()) {
  return {
    AND: [
      { OR: [{ audience: null }, { audience: role }] },
      ...(branchIds ? [{ OR: [{ branchId: null }, { branchId: { in: branchIds } }] }] : []),
      ...(batchIds ? [{ OR: [{ batchId: null }, { batchId: { in: batchIds } }] }] : []),
      { publishedAt: { lte: now } },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
    ],
  };
}
