import { z } from "zod";

const settingsRecord = z.record(z.any());

export const organizationBrandingSchema = z.object({
  name: z.string().min(2).max(160),
  legalName: z.string().max(200).nullable().optional(),
  email: z.string().email(),
  phone: z.string().max(20).nullable().optional(),
  logoUrl: z.string().url().max(1000).nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  timezone: z.string().min(3).max(60),
  locale: z.string().min(2).max(20),
  currency: z.string().length(3),
  academicYearStartMonth: z.number().int().min(1).max(12),
  settings: z.preprocess((value) => value === null ? {} : value, settingsRecord.optional()),
});

export const organizationSettingsUpdateSchema = organizationBrandingSchema
  .partial()
  .omit({ email: true });
