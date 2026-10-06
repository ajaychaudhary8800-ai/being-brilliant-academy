import crypto from "node:crypto";
import { AppError } from "./http.js";

export const aiExaminerEvidenceMimeTypes = [
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AIExaminerEvidenceMimeType = typeof aiExaminerEvidenceMimeTypes[number];

const extensions: Record<AIExaminerEvidenceMimeType, readonly string[]> = {
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/webm": ["webm"],
  "video/mp4": ["mp4", "m4v"],
  "video/webm": ["webm"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

function strictBase64(value: string) {
  const paddingAt = value.indexOf("=");
  const padding = paddingAt === -1 ? "" : value.slice(paddingAt);
  if (!value || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)
    || (paddingAt !== -1 && (paddingAt < value.length - 2 || !/^={1,2}$/.test(padding)))) {
    throw new AppError(422, "INVALID_BASE64", "Evidence content is not valid base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new AppError(422, "INVALID_BASE64", "Evidence content is not valid base64");
  }
  return bytes;
}

function fileExtension(fileName: string) {
  if (!fileName || fileName.length > 255 || fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0")) {
    throw new AppError(422, "INVALID_FILE_NAME", "Evidence filename is invalid");
  }
  return fileName.toLocaleLowerCase("en").split(".").pop() ?? "";
}

function matches(bytes: Buffer, mimeType: AIExaminerEvidenceMimeType) {
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mimeType === "image/webp") return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "audio/mpeg") {
    return bytes.subarray(0, 3).toString("ascii") === "ID3"
      || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
  }
  if (mimeType === "audio/webm" || mimeType === "video/webm") {
    return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  }
  if (mimeType === "audio/mp4" || mimeType === "video/mp4") {
    return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  }
  return false;
}

export function decodeAIExaminerEvidenceUpload(input: {
  base64: string;
  fileName: string;
  mimeType: AIExaminerEvidenceMimeType;
  maximumBytes?: number;
}) {
  const extension = fileExtension(input.fileName);
  if (!extensions[input.mimeType].includes(extension)) {
    throw new AppError(422, "FILE_EXTENSION_MISMATCH", "Evidence filename extension does not match the declared MIME type");
  }
  const maximumBytes = input.maximumBytes ?? 10 * 1024 * 1024;
  const bytes = strictBase64(input.base64);
  if (!bytes.length || bytes.length > maximumBytes) {
    throw new AppError(422, "INVALID_FILE_SIZE", `Evidence file must be between 1 byte and ${Math.floor(maximumBytes / 1024 / 1024)} MB`);
  }
  if (!matches(bytes, input.mimeType)) {
    throw new AppError(422, "FILE_TYPE_MISMATCH", "Evidence content does not match the declared MIME type");
  }
  return {
    bytes,
    contentSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

export function assertAIExaminerEvidenceKindMatchesMime(kind: string, mimeType: AIExaminerEvidenceMimeType) {
  const family = mimeType.split("/")[0];
  if (kind === "AUDIO" && family !== "audio") throw new AppError(422, "EVIDENCE_KIND_MISMATCH", "Audio evidence requires an audio MIME type");
  if (kind === "VIDEO" && family !== "video") throw new AppError(422, "EVIDENCE_KIND_MISMATCH", "Video evidence requires a video MIME type");
  if (kind === "IMAGE" && family !== "image") throw new AppError(422, "EVIDENCE_KIND_MISMATCH", "Image evidence requires an image MIME type");
  if (kind === "DOCUMENT" && mimeType !== "application/pdf") throw new AppError(422, "EVIDENCE_KIND_MISMATCH", "Document evidence currently supports PDF only");
}

export function normalizeAIExaminerEvidenceUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(422, "INVALID_EVIDENCE_URL", "Evidence reference must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new AppError(422, "INVALID_EVIDENCE_URL", "Evidence reference must be an HTTPS URL without embedded credentials");
  }
  return url.toString();
}
