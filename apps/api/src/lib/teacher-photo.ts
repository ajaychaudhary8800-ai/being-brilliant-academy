import crypto from "node:crypto";
import { AppError } from "./http.js";
import type { AllowedTeacherPhotoType } from "./secure-upload.js";

const organizationSegment = /^[A-Za-z0-9_-]{1,100}$/;
const photoFileName = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;
const publicPrefix = "/api/v1/teacher-photos/";

const extensions: Record<AllowedTeacherPhotoType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function createTeacherPhotoLocation(organizationId: string, mimeType: AllowedTeacherPhotoType) {
  if (!organizationSegment.test(organizationId)) throw new AppError(422, "INVALID_ORGANIZATION", "Organization identifier cannot be used for storage");
  const fileName = `${crypto.randomUUID()}.${extensions[mimeType]}`;
  return {
    key: `teacher-photos/${organizationId}/${fileName}`,
    url: `${publicPrefix}${organizationId}/${fileName}`,
  };
}

export function parseTeacherPhotoLocation(value: string, organizationId?: string) {
  let pathname = value;
  try {
    if (/^https?:\/\//i.test(value)) pathname = new URL(value).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(publicPrefix)) return null;
  const parts = pathname.slice(publicPrefix.length).split("/");
  if (parts.length !== 2) return null;
  const [pathOrganizationId, fileName] = parts;
  if (!organizationSegment.test(pathOrganizationId) || !photoFileName.test(fileName)) return null;
  if (organizationId && pathOrganizationId !== organizationId) return null;
  return { key: `teacher-photos/${pathOrganizationId}/${fileName}`, organizationId: pathOrganizationId, fileName };
}

export function teacherPhotoMimeType(fileName: string): AllowedTeacherPhotoType | null {
  if (fileName.endsWith(".jpg")) return "image/jpeg";
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".webp")) return "image/webp";
  return null;
}
