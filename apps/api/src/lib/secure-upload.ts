import { AppError } from "./http.js";

export const allowedDocumentTypes = ["application/pdf", "image/jpeg", "image/png", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
export type AllowedDocumentType = typeof allowedDocumentTypes[number];

function strictBase64(value: string) {
  if (!value || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new AppError(422, "INVALID_BASE64", "File content is not valid base64");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new AppError(422, "INVALID_BASE64", "File content is not valid base64");
  return bytes;
}

function matches(bytes: Buffer, mimeType: AllowedDocumentType) {
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
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
