import { z } from "zod";
import { GroupLabelType } from "@prisma/client";

const settingsRecord = z.record(z.any());
const organizationLogoReference = z.union([
  z.string().url().max(1000),
  z.string().regex(/^\/api\/v1\/uploaded-images\/organization-logo\/[A-Za-z0-9_-]{1,100}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/, "Invalid organization logo reference"),
]);

export const organizationBrandingSchema = z.object({
  name: z.string().min(2).max(160),
  legalName: z.string().max(200).nullable().optional(),
  email: z.string().email(),
  phone: z.string().max(20).nullable().optional(),
  logoUrl: organizationLogoReference.nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  timezone: z.string().min(3).max(60),
  locale: z.string().min(2).max(20),
  currency: z.string().length(3),
  academicYearStartMonth: z.number().int().min(1).max(12),
  groupLabelType: z.nativeEnum(GroupLabelType).optional(),
  customGroupLabel: z.string().trim().min(2).max(40).nullable().optional(),
  settings: z.preprocess((value) => value === null ? {} : value, settingsRecord.optional()),
});

export const organizationSettingsUpdateSchema = organizationBrandingSchema
  .partial()
  .omit({ email: true });
