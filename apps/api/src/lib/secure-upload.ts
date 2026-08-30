import { AppError } from "./http.js";

export const allowedDocumentTypes = ["application/pdf", "image/jpeg", "image/png", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
export type AllowedDocumentType = typeof allowedDocumentTypes[number];
export const allowedTeacherPhotoTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedTeacherPhotoType = typeof allowedTeacherPhotoTypes[number];
export const allowedImageTypes = allowedTeacherPhotoTypes;
export type AllowedImageType = AllowedTeacherPhotoType;
const imageExtensions: Record<AllowedImageType, readonly string[]> = { "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"] };

export function assertImageFileExtension(fileName: string, mimeType: AllowedImageType) {
  if (!fileName || fileName.length > 255 || fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0")) throw new AppError(422, "INVALID_FILE_NAME", "Image filename is invalid");
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (!imageExtensions[mimeType].includes(extension)) throw new AppError(422, "FILE_EXTENSION_MISMATCH", "Image filename extension does not match the declared image type");
}

function strictBase64(value: string) {
  const paddingAt = value.indexOf("=");
  const padding = paddingAt === -1 ? "" : value.slice(paddingAt);
  if (!value || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value) || (paddingAt !== -1 && (paddingAt < value.length - 2 || !/^={1,2}$/.test(padding)))) throw new AppError(422, "INVALID_BASE64", "File content is not valid base64");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new AppError(422, "INVALID_BASE64", "File content is not valid base64");
  return bytes;
}

function matches(bytes: Buffer, mimeType: AllowedDocumentType | AllowedTeacherPhotoType) {
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "application/msword") return bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (!bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return false;
  const packageText = bytes.toString("latin1");
  return packageText.includes("[Content_Types].xml") && packageText.includes("word/");
}

export function decodeVerifiedUpload(base64: string, mimeType: AllowedDocumentType, maximumBytes = 10 * 1024 * 1024) {
  const fileData = strictBase64(base64);
  if (!fileData.length || fileData.length > maximumBytes) throw new AppError(422, "INVALID_FILE_SIZE", `File must be between 1 byte and ${Math.floor(maximumBytes / 1024 / 1024)} MB`);
  if (!matches(fileData, mimeType)) throw new AppError(422, "FILE_TYPE_MISMATCH", "Decoded file content does not match the declared file type");
  return fileData;
}

export function decodeVerifiedTeacherPhoto(base64: string, mimeType: AllowedTeacherPhotoType, maximumBytes = 5 * 1024 * 1024) {
  const fileData = strictBase64(base64);
  if (!fileData.length || fileData.length > maximumBytes) throw new AppError(422, "INVALID_FILE_SIZE", `Photo must be between 1 byte and ${Math.floor(maximumBytes / 1024 / 1024)} MB`);
  if (!matches(fileData, mimeType)) throw new AppError(422, "FILE_TYPE_MISMATCH", "Photo content does not match the declared image type");
  return fileData;
}

export const decodeVerifiedImage = decodeVerifiedTeacherPhoto;
