import { z } from "zod";

export const securePasswordSchema = z.string()
  .min(10)
  .max(128)
  .regex(/[A-Z]/)
  .regex(/[a-z]/)
  .regex(/[0-9]/);
