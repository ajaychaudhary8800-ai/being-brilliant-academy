export type AllocationSelection = { courseId: string; batchIds: string[]; subjectIds: string[] };

/** Expands only the explicitly selected subjects for each course. */
export function expandAllocationSelections(selections: AllocationSelection[]) {
  return selections.flatMap(selection => selection.batchIds.flatMap(batchId => selection.subjectIds.map(subjectId => ({ courseId: selection.courseId, batchId, subjectId }))));
}
