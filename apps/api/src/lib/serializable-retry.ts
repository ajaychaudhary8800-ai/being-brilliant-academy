import { AppError } from "./http.js";

/**
 * Retrying a serialized, atomic PostgreSQL write is safe only when the caller
 * constructs the entire Prisma transaction inside the callback; never retry
 * external side effects (email, provider charges, network events).
 *
 * Used for the branch + manager provisioning transaction so transient P2034
 * conflicts cannot strand a half-created branch or bubble up as HTTP 500.
 */
export async function retrySerializableWrite<T>(
  transaction: () => Promise<T>,
  options: { attempts?: number; conflictCode?: string } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new Error("Serializable retry attempts must be between 1 and 5");
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await transaction();
    } catch (error) {
      // Prisma interactive transactions emit P2034. PostgreSQL conflicts
      // raised by raw SELECT ... FOR UPDATE can surface instead as P2010
      // carrying the SQLSTATE in meta.code (40001 serialization, 40P01 deadlock).
      // Do not retry arbitrary SQL errors, constraint violations or network I/O.
      const candidate = error && typeof error === "object"
        ? error as { code?: unknown; meta?: { code?: unknown } }
        : null;
      const conflict = candidate?.code === "P2034"
        || (candidate?.code === "P2010"
          && (candidate.meta?.code === "40001" || candidate.meta?.code === "40P01"));
      if (!conflict) throw error;
      if (attempt === attempts) {
        throw new AppError(
          409,
          options.conflictCode ?? "SERIALIZABLE_WRITE_CONFLICT",
          "The record changed concurrently. Please retry the operation.",
        );
      }
      await new Promise(resolve => setTimeout(resolve, attempt * 25));
    }
  }
  throw new AppError(409, "SERIALIZABLE_WRITE_CONFLICT", "Please retry the operation.");
}
