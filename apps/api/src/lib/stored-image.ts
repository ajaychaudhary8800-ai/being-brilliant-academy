import crypto from "node:crypto";
import { AppError } from "./http.js";
import type { AllowedImageType } from "./secure-upload.js";

export const storedImageKinds = ["student-photo", "organization-logo"] as const;
export type StoredImageKind = typeof storedImageKinds[number];

const organizationSegment = /^[A-Za-z0-9_-]{1,100}$/;
const imageFileName = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;
export const storedImagePublicPrefix = "/api/v1/uploaded-images/";
const extensions: Record<AllowedImageType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function createStoredImageLocation(kind: StoredImageKind, organizationId: string, mimeType: AllowedImageType) {
  if (!organizationSegment.test(organizationId)) throw new AppError(422, "INVALID_ORGANIZATION", "Organization identifier cannot be used for storage");
  const fileName = `${crypto.randomUUID()}.${extensions[mimeType]}`;
  return {
    key: `uploaded-images/${kind}/${organizationId}/${fileName}`,
    url: `${storedImagePublicPrefix}${kind}/${organizationId}/${fileName}`,
  };
}

export function parseStoredImageLocation(value: string, organizationId?: string, expectedKind?: StoredImageKind) {
  let pathname = value;
  try {
    if (/^https?:\/\//i.test(value)) pathname = new URL(value).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(storedImagePublicPrefix)) return null;
  const parts = pathname.slice(storedImagePublicPrefix.length).split("/");
  if (parts.length !== 3) return null;
  const [kind, pathOrganizationId, fileName] = parts;
  if (!storedImageKinds.includes(kind as StoredImageKind) || !organizationSegment.test(pathOrganizationId) || !imageFileName.test(fileName)) return null;
  if (organizationId && pathOrganizationId !== organizationId) return null;
  if (expectedKind && kind !== expectedKind) return null;
  return { key: `uploaded-images/${kind}/${pathOrganizationId}/${fileName}`, kind: kind as StoredImageKind, organizationId: pathOrganizationId, fileName };
}

export function storedImageMimeType(fileName: string): AllowedImageType | null {
  if (fileName.endsWith(".jpg")) return "image/jpeg";
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".webp")) return "image/webp";
  return null;
}
