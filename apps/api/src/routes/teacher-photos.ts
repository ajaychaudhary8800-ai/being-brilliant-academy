import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allowedTeacherPhotoTypes, decodeVerifiedTeacherPhoto } from "../lib/secure-upload.js";
import { deleteObject, getObject, putObject } from "../lib/storage.js";
import { createTeacherPhotoLocation, parseTeacherPhotoLocation, teacherPhotoMimeType } from "../lib/teacher-photo.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
const uploadInput = z.object({
  mimeType: z.enum(allowedTeacherPhotoTypes),
  base64: z.string().max(7_000_000, "Photo must not exceed 5 MB"),
}).strict();

async function readStoredObject(key: string) {
  const object = await getObject(key);
  if (!object || !(Symbol.asyncIterator in Object(object))) throw new AppError(404, "PHOTO_NOT_FOUND", "Teacher photo not found");
  const chunks: Buffer[] = [];
  for await (const chunk of object as AsyncIterable<Uint8Array | string>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

router.get("/teacher-photos/:organizationId/:fileName", async (req, res) => {
  const value = `/api/v1/teacher-photos/${String(req.params.organizationId)}/${String(req.params.fileName)}`;
  const location = parseTeacherPhotoLocation(value);
  const mimeType = location && teacherPhotoMimeType(location.fileName);
  if (!location || !mimeType) throw new AppError(404, "PHOTO_NOT_FOUND", "Teacher photo not found");
  try {
    const body = await readStoredObject(location.key);
    res.set({ "Content-Type": mimeType, "Content-Length": String(body.length), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
    res.send(body);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "NoSuchKey" || code === "NotFound") throw new AppError(404, "PHOTO_NOT_FOUND", "Teacher photo not found");
    throw error;
  }
});

router.post("/admin/teacher-photos", requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN), async (req: AuthRequest, res) => {
  const input = uploadInput.parse(req.body);
  const photo = decodeVerifiedTeacherPhoto(input.base64, input.mimeType);
  const location = createTeacherPhotoLocation(req.auth!.organizationId, input.mimeType);
  await putObject(location.key, photo, input.mimeType);
  res.status(201).json({ data: { url: location.url } });
});

router.delete("/admin/teacher-photos", requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN), async (req: AuthRequest, res) => {
  const { url } = z.object({ url: z.string().min(1).max(500) }).strict().parse(req.body);
  const location = parseTeacherPhotoLocation(url, req.auth!.organizationId);
  if (!location) throw new AppError(422, "INVALID_PHOTO_REFERENCE", "Photo does not belong to this organization");
  const references = await prisma.user.count({ where: { organizationId: req.auth!.organizationId, avatarUrl: url } });
  if (references) throw new AppError(409, "PHOTO_IN_USE", "Photo is still assigned to a user");
  await deleteObject(location.key);
  res.status(204).send();
});

export default router;
