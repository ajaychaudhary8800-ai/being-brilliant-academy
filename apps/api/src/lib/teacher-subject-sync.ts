export type TeacherSubjectSyncPlan = {
  keepSubjectIds: string[];
  removeSubjectIds: string[];
  blockedSubjectIds: string[];
};

export function planTeacherSubjectSync(existingSubjectIds: string[], submittedSubjectIds: string[], activeAllocationSubjectIds: string[] = []): TeacherSubjectSyncPlan {
  const submitted = new Set(submittedSubjectIds);
  const active = new Set(activeAllocationSubjectIds);
  const removeSubjectIds = [...new Set(existingSubjectIds)].filter(subjectId => !submitted.has(subjectId));
  return {
    keepSubjectIds: [...submitted],
    removeSubjectIds,
    blockedSubjectIds: removeSubjectIds.filter(subjectId => active.has(subjectId)),
  };
}
