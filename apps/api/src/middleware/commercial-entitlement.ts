import type { NextFunction, Response } from "express";
import { AppError } from "../lib/http.js";
import { assertFeatureEntitled } from "../lib/saas-commercial.js";
import type { AuthRequest } from "./auth.js";

export function requireCommercialFeature(feature: string) {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) throw new AppError(401, "AUTH_REQUIRED", "Authentication required");
      await assertFeatureEntitled(req.auth.organizationId, feature);
      next();
    } catch (error) {
      next(error);
    }
  };
}
