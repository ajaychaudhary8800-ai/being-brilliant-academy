import { Role } from "@prisma/client";
import { Router } from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AppError } from "../lib/http.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

const roadmapUrl = new URL("../../../../config/project-roadmap.json", import.meta.url);
const launchReadinessUrl = new URL("../../../../config/launch-readiness.json", import.meta.url);

function requirePlatformAdmin(req: AuthRequest) {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}

async function readJson(url: URL) {
  return JSON.parse(await readFile(fileURLToPath(url), "utf8"));
}

router.use(requireAuth);

router.get("/platform/control-center", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const [roadmap, launch] = await Promise.all([
    readJson(roadmapUrl),
    readJson(launchReadinessUrl),
  ]);
  res.json({
    data: {
      roadmap,
      launch,
      generatedAt: new Date().toISOString(),
    },
  });
});

export default router;
