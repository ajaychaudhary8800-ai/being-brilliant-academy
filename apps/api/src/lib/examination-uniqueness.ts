import { AppError } from "./http.js";

type PrismaErrorLike = {
  code?: unknown;
  meta?: { target?: unknown } | null;
};

export function isExaminationCodeConflict(error: unknown) {
  const candidate = error as PrismaErrorLike | null;
  if (candidate?.code !== "P2002") return false;

  const target = candidate.meta?.target;
  if (Array.isArray(target)) {
    return target.includes("organizationId") && target.includes("code");
  }

  return typeof target === "string" && target.includes("Examination_organizationId_code_key");
}

export function examinationCodeConflict() {
  return new AppError(409, "EXAMINATION_CODE_EXISTS", "Examination code already exists in this organization");
}
