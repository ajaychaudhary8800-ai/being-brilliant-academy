export type ParentLeaveChild = {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string;
  batch: { name: string; code: string };
  relationship: string;
};

export function parentLeaveSelection(children: readonly ParentLeaveChild[], currentStudentId: string) {
  if (children.length === 1) return children[0].studentId;
  return children.some(child => child.studentId === currentStudentId) ? currentStudentId : "";
}

export function parentLeaveChildSummary(child: ParentLeaveChild) {
  return `${child.name} · ${child.admissionNo} · ${child.className} · ${child.batch.name}`;
}
