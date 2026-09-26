import { z } from "zod";

export const automationTriggerType = z.enum(["FEE_OVERDUE", "HOMEWORK_DUE_SOON", "ENQUIRY_FOLLOW_UP_DUE"]);
export type AutomationTriggerType = z.infer<typeof automationTriggerType>;

const feeConfig = z.object({
  daysOverdue: z.coerce.number().int().min(0).max(365).default(0),
  minBalancePaise: z.coerce.number().int().min(0).max(100_000_000).default(0),
}).strict();

const homeworkConfig = z.object({
  dueWithinHours: z.coerce.number().int().min(1).max(168).default(24),
}).strict();

const enquiryConfig = z.object({
  overdueHours: z.coerce.number().int().min(0).max(720).default(0),
}).strict();

export const notificationActionConfig = z.object({
  channels: z.array(z.enum(["IN_APP", "EMAIL"])).min(1).max(2)
    .transform(values => [...new Set(values)]),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(1000),
}).strict();

export function parseTriggerConfig(type: AutomationTriggerType, input: unknown) {
  if (type === "FEE_OVERDUE") return feeConfig.parse(input ?? {});
  if (type === "HOMEWORK_DUE_SOON") return homeworkConfig.parse(input ?? {});
  return enquiryConfig.parse(input ?? {});
}

export function feeOutstanding(totalPaise: number, discountPaise: number, finePaise: number, amountPaidPaise: number) {
  return Math.max(0, totalPaise - discountPaise + finePaise - amountPaidPaise);
}
