export type AdminOptionUrls = { branches: string; batches: string };

export function activeAdminOptionUrls(api: string): AdminOptionUrls {
  return {
    // The branches route intentionally exposes the legacy lowercase filter contract.
    branches: `${api}/admin/branches?limit=100&status=active`,
    // BatchStatus is a Prisma/Zod enum and must remain uppercase on the wire.
    batches: `${api}/admin/batches?limit=100&status=ACTIVE`,
  };
}
