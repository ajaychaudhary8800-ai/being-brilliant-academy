import { HomeworkSubmissionStatus } from "@prisma/client";
import { AppError } from "./http.js";

export const replaceableHomeworkSubmissionStatuses: HomeworkSubmissionStatus[] = [
  HomeworkSubmissionStatus.SUBMITTED,
  HomeworkSubmissionStatus.LATE,
];

export function assertHomeworkSubmissionReplaceable(status: HomeworkSubmissionStatus) {
  if (!replaceableHomeworkSubmissionStatuses.includes(status)) {
    throw new AppError(409, "SUBMISSION_REVIEW_STARTED", "A reviewed submission cannot be replaced");
  }
}

export function assertHomeworkSubmissionReplaced(count: number) {
  if (count !== 1) {
    throw new AppError(409, "SUBMISSION_REVIEW_STARTED", "A reviewed submission cannot be replaced");
  }
}
