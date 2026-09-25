import { Role } from "@prisma/client";
import { Router } from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AppError } from "../lib/http.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

function configCandidates(fileName: string) {
  return [
    // Source runtime: apps/api/src/routes -> repository root.
    new URL(`../../../../config/${fileName}`, import.meta.url),
    // Compiled runtime: apps/api/dist/src/routes -> repository root.
    new URL(`../../../../../config/${fileName}`, import.meta.url),
  ];
}

const roadmapUrls = configCandidates("project-roadmap.json");
const launchReadinessUrls = configCandidates("launch-readiness.json");

function requirePlatformAdmin(req: AuthRequest) {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}

async function readJson(urls: URL[]) {
  let lastMissing: unknown;
  for (const url of urls) {
    try {
      const raw = await readFile(fileURLToPath(url), "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      lastMissing = error;
    }
  }
  throw lastMissing ?? new Error("Control center configuration file was not found");
}

router.use(requireAuth);

router.get("/platform/control-center", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const [roadmap, launch] = await Promise.all([
    readJson(roadmapUrls),
    readJson(launchReadinessUrls),
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
