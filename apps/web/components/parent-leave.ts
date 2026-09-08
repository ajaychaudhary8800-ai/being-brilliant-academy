export type ParentLeaveChild = {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string;
  batch: { name: string; code: string; course?: { title: string } | null };
  relationship: string;
};

export function parentLeaveSelection(children: readonly ParentLeaveChild[], currentStudentId: string) {
  if (children.length === 1) return children[0].studentId;
  return children.some(child => child.studentId === currentStudentId) ? currentStudentId : "";
}

export function parentLeaveChildSummary(child: ParentLeaveChild) {
  return `${child.name} · ${child.admissionNo} · ${parentLeaveAcademicLabel(child)}`;
}

export function looksLikeInternalId(value?: string | null) {
  if (!value) return false;
  return /^c[a-z0-9]{20,}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

export function parentLeaveAcademicLabel(child: Pick<ParentLeaveChild, "className" | "batch">) {
  const className = child.className?.trim();
  if (className && !looksLikeInternalId(className)) return className;
  return child.batch.course?.title?.trim() || child.batch.name;
}
