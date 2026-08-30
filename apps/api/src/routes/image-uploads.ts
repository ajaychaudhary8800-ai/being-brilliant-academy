import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import { allowedImageTypes, assertImageFileExtension, decodeVerifiedImage } from "../lib/secure-upload.js";
import { deleteObject, getObject, putObject } from "../lib/storage.js";
import { createStoredImageLocation, parseStoredImageLocation, storedImageKinds, storedImageMimeType } from "../lib/stored-image.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
const uploadInput = z.object({
  kind: z.enum(storedImageKinds),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(allowedImageTypes),
  base64: z.string().max(7_000_000, "Image must not exceed 5 MB"),
}).strict();

async function readStoredObject(key: string) {
  const object = await getObject(key);
  if (!object || !(Symbol.asyncIterator in Object(object))) throw new AppError(404, "IMAGE_NOT_FOUND", "Uploaded image not found");
  const chunks: Buffer[] = [];
  for await (const chunk of object as AsyncIterable<Uint8Array | string>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

router.get("/uploaded-images/:kind/:organizationId/:fileName", async (req, res) => {
  const value = `/api/v1/uploaded-images/${String(req.params.kind)}/${String(req.params.organizationId)}/${String(req.params.fileName)}`;
  const location = parseStoredImageLocation(value);
  const mimeType = location && storedImageMimeType(location.fileName);
  if (!location || !mimeType) throw new AppError(404, "IMAGE_NOT_FOUND", "Uploaded image not found");
  try {
    const body = await readStoredObject(location.key);
    res.set({ "Content-Type": mimeType, "Content-Length": String(body.length), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
    res.send(body);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "NoSuchKey" || code === "NotFound") throw new AppError(404, "IMAGE_NOT_FOUND", "Uploaded image not found");
    throw error;
  }
});

router.post("/admin/image-uploads", requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN), async (req: AuthRequest, res) => {
  const input = uploadInput.parse(req.body);
  assertImageFileExtension(input.fileName, input.mimeType);
  const image = decodeVerifiedImage(input.base64, input.mimeType);
  const location = createStoredImageLocation(input.kind, req.auth!.organizationId, input.mimeType);
  await putObject(location.key, image, input.mimeType);
  res.status(201).json({ data: { url: location.url } });
});

router.delete("/admin/image-uploads", requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN), async (req: AuthRequest, res) => {
  const { url } = z.object({ url: z.string().min(1).max(1000) }).strict().parse(req.body);
  const location = parseStoredImageLocation(url, req.auth!.organizationId);
  if (!location) throw new AppError(422, "INVALID_IMAGE_REFERENCE", "Image does not belong to this organization");
  const references = location.kind === "student-photo"
    ? await prisma.user.count({ where: { organizationId: req.auth!.organizationId, avatarUrl: url } })
    : await systemPrisma.organization.count({ where: { id: req.auth!.organizationId, logoUrl: url } });
  if (references) throw new AppError(409, "IMAGE_IN_USE", "Image is still assigned to a record");
  await deleteObject(location.key);
  res.status(204).send();
});

export default router;
