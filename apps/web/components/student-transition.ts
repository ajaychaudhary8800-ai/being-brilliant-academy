export type StudentTransitionType = "PROMOTED" | "RETAINED" | "TRANSFERRED" | "LEFT" | "GRADUATED";

export const destinationTransitionTypes: readonly StudentTransitionType[] = ["PROMOTED", "RETAINED", "TRANSFERRED"];

export function transitionRequiresDestination(type: StudentTransitionType) {
  return destinationTransitionTypes.includes(type);
}

export function localCivilDate(value = new Date()) {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

export function normalizeTransitionRollNo(value: string) {
  return value.trim().toUpperCase();
}

export function filterDestinationBatches<T extends { id: string; status?: string; course?: { id: string } | null }>(batches: T[], type: StudentTransitionType, sourceBatchId?: string, sourceCourseId?: string | null) {
  return batches.filter(batch => {
    if (batch.status && batch.status !== "ACTIVE") return false;
    if (batch.id === sourceBatchId) return false;
    if (type === "RETAINED" && sourceCourseId && batch.course?.id !== sourceCourseId) return false;
    return true;
  });
}

export type StudentTransitionDraft = {
  type: StudentTransitionType;
  effectiveDate: string;
  targetBatchId?: string;
  rollNo?: string;
  reason?: string;
};

export function buildTransitionPayload(draft: StudentTransitionDraft) {
  const payload: Record<string, string> = {
    type: draft.type,
    effectiveDate: draft.effectiveDate,
  };
  if (transitionRequiresDestination(draft.type)) {
    if (draft.targetBatchId) payload.targetBatchId = draft.targetBatchId;
    if (draft.rollNo?.trim()) payload.rollNo = normalizeTransitionRollNo(draft.rollNo);
  }
  if (draft.reason?.trim()) payload.reason = draft.reason.trim();
  return payload;
}

const transitionErrorMessages: Record<string, string> = {
  BATCH_CAPACITY_REACHED: "The selected destination has reached capacity. Choose another destination batch or try again after capacity changes.",
  ACADEMIC_ENROLLMENT_CONFLICT: "The destination placement conflicts with an existing active enrollment or roll number.",
  ACADEMIC_TRANSITION_CONFLICT: "The student's placement changed while you were working. Reload the current placement before retrying.",
  ACADEMIC_TRANSITION_FORBIDDEN: "You are not authorized to use one of the placements involved in this transition.",
  NO_ACTIVE_ACADEMIC_ENROLLMENT: "This student has no active academic placement. Reload the student before retrying.",
  ACADEMIC_ENROLLMENT_INTEGRITY_ERROR: "The student's academic records are inconsistent. Ask an administrator to review them before retrying.",
  INVALID_TRANSITION_DATE: "The transition date cannot be earlier than the current enrollment start date.",
  INVALID_TRANSITION_TARGET: "The selected destination is not valid for this transition. Review the destination and try again.",
};

export function transitionErrorMessage(code?: string, fallback = "Unable to complete the academic transition.") {
  return (code && transitionErrorMessages[code]) || fallback;
}
