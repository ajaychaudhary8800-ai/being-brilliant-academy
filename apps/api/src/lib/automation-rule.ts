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
  channels: z.array(z.enum(["IN_APP", "EMAIL"])).min(1).max(4)
    .transform(values => [...new Set(values)])
    .refine(values => values.length <= 2, "Choose no more than two delivery channels"),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(1000),
}).strict();

type FeeAutomationConfig = z.infer<typeof feeConfig>;
type HomeworkAutomationConfig = z.infer<typeof homeworkConfig>;
type EnquiryAutomationConfig = z.infer<typeof enquiryConfig>;
export type AutomationTriggerConfig = FeeAutomationConfig | HomeworkAutomationConfig | EnquiryAutomationConfig;

export function parseTriggerConfig(type: "FEE_OVERDUE", input: unknown): FeeAutomationConfig;
export function parseTriggerConfig(type: "HOMEWORK_DUE_SOON", input: unknown): HomeworkAutomationConfig;
export function parseTriggerConfig(type: "ENQUIRY_FOLLOW_UP_DUE", input: unknown): EnquiryAutomationConfig;
export function parseTriggerConfig(type: AutomationTriggerType, input: unknown): AutomationTriggerConfig;
export function parseTriggerConfig(type: AutomationTriggerType, input: unknown): AutomationTriggerConfig {
  if (type === "FEE_OVERDUE") return feeConfig.parse(input ?? {});
  if (type === "HOMEWORK_DUE_SOON") return homeworkConfig.parse(input ?? {});
  return enquiryConfig.parse(input ?? {});
}

export function feeOutstanding(totalPaise: number, discountPaise: number, finePaise: number, amountPaidPaise: number) {
  return Math.max(0, totalPaise - discountPaise + finePaise - amountPaidPaise);
}
