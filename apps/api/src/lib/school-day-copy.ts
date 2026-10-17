import { AppError } from "./http.js";

export type BellCopySlot = {
  periodNumber: number; startMinute: number; endMinute: number;
  type: string; label: string | null; isActive: boolean;
};
export type CopySourceLesson = {
  id: string; periodNumber: number; startMinute: number; endMinute: number;
};

/** Copy an entire school day's active lessons only when both bell templates
 * have the same teaching/break sequence. BREAK slots belong to the branch's
 * bell template, so no artificial lunch/assembly subject is created. */
export function mapSchoolDayCopy<T extends CopySourceLesson>(
  sourceSlots: BellCopySlot[], targetSlots: BellCopySlot[], lessons: T[],
): Array<T & { startMinute: number; endMinute: number }> {
  const source = sourceSlots.filter(s => s.isActive).sort((a,b) => a.periodNumber-b.periodNumber);
  const target = targetSlots.filter(s => s.isActive).sort((a,b) => a.periodNumber-b.periodNumber);
  if (!source.length || source.length !== target.length || source.length > 50) {
    throw new AppError(422, "COPY_BELL_TEMPLATE_MISMATCH", "Both weekdays need matching configured teaching and break periods");
  }
  const dest = new Map<number, BellCopySlot>();
  for (let i=0;i<source.length;i++) {
    const a=source[i], b=target[i];
    if (a.periodNumber !== b.periodNumber || a.type !== b.type ||
      (a.type === "BREAK" && (a.label??"").trim().toLowerCase() !== (b.label??"").trim().toLowerCase())) {
      throw new AppError(422, "COPY_BELL_TEMPLATE_MISMATCH", "Target weekday period types and break labels must match the source");
    }
    if (a.startMinute >= a.endMinute || b.startMinute >= b.endMinute || dest.has(b.periodNumber)) {
      throw new AppError(422, "COPY_INVALID_BELL_TEMPLATE", "Configured timetable periods must have unique numbers and valid times");
    }
    dest.set(b.periodNumber,b);
  }
  if (!lessons.length || lessons.length > 50) {
    throw new AppError(422, "COPY_EMPTY_SOURCE_DAY", "The source weekday must have saved teaching periods");
  }
  const seen = new Set<number>();
  return lessons.map(lesson => {
    const from=source.find(p=>p.periodNumber===lesson.periodNumber);
    const to=dest.get(lesson.periodNumber);
    if (!from || !to || from.type!=="TEACHING" || to.type!=="TEACHING" ||
      from.startMinute!==lesson.startMinute || from.endMinute!==lesson.endMinute ||
      seen.has(lesson.periodNumber)) {
      throw new AppError(422, "COPY_SOURCE_DAY_MISMATCH", "Source lessons must match active teaching slots without duplicate periods");
    }
    seen.add(lesson.periodNumber);
    return { ...lesson, startMinute:to.startMinute, endMinute:to.endMinute };
  }).sort((a,b)=>a.periodNumber-b.periodNumber);
}
