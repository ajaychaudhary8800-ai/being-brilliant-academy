import type { AcademicBoard, AcademicPreparationType, AcademicStream, ClassLevel, CourseCategoryType, ScienceCombination } from "@prisma/client";

export const academicClassLevels = ["PLAY", "NURSERY", "LKG", "UKG", "CLASS_1", "CLASS_2", "CLASS_3", "CLASS_4", "CLASS_5", "CLASS_6", "CLASS_7", "CLASS_8", "CLASS_9", "CLASS_10", "CLASS_11", "CLASS_12"] as const;
export const seniorClassLevels = new Set<ClassLevel>(["CLASS_11", "CLASS_12"]);

export type CourseTaxonomy = {
  categoryType: CourseCategoryType;
  classLevel?: ClassLevel | null;
  academicBoard?: AcademicBoard | null;
  customBoardName?: string | null;
  academicStream?: AcademicStream | null;
  scienceCombination?: ScienceCombination | null;
  academicPreparation?: AcademicPreparationType | null;
  competitiveExamId?: string | null;
  skillCategoryId?: string | null;
};

export function courseTaxonomyError(value: CourseTaxonomy): string | null {
  const senior = value.classLevel ? seniorClassLevels.has(value.classLevel) : false;
  if (value.categoryType === "ACADEMIC") {
    if (!value.classLevel || !academicClassLevels.includes(value.classLevel as typeof academicClassLevels[number])) return "Academic courses require a class level from Play through Class 12";
    if (!value.academicBoard) return "Academic courses require a board";
    if (value.academicBoard === "OTHER" && !value.customBoardName?.trim()) return "Enter the custom board name";
    if (value.academicBoard !== "OTHER" && value.customBoardName) return "Custom board name is only valid when Board is Other";
    if (value.competitiveExamId || value.skillCategoryId) return "Academic courses cannot use competitive-exam or skill-category fields";
    if (!senior && (value.academicStream || value.scienceCombination || value.academicPreparation)) return "Stream, science combination and preparation apply only to Classes 11 and 12";
    if (senior && !value.academicStream) return "Classes 11 and 12 require an academic stream";
    if (senior && value.academicStream !== "SCIENCE" && (value.scienceCombination || value.academicPreparation)) return "Science combination and preparation apply only to the Science stream";
    if (value.academicStream === "SCIENCE" && (!value.scienceCombination || !value.academicPreparation)) return "Science courses require a combination and preparation type";
    if (value.academicPreparation === "ACADEMIC_JEE" && !new Set(["PCM", "PCMB"]).has(value.scienceCombination ?? "")) return "Academic + JEE requires PCM or PCMB";
    if (value.academicPreparation === "ACADEMIC_NEET" && !new Set(["PCB", "PCMB"]).has(value.scienceCombination ?? "")) return "Academic + NEET requires PCB or PCMB";
    return null;
  }
  if (value.categoryType === "COMPETITIVE") {
    if (!value.competitiveExamId) return "Competitive courses require a competitive exam";
    if (value.classLevel || value.academicBoard || value.customBoardName || value.academicStream || value.scienceCombination || value.academicPreparation || value.skillCategoryId) return "Competitive courses cannot use school or skill fields";
    return null;
  }
  if (!value.skillCategoryId) return "Skill-based courses require a skill category";
  if (value.classLevel || value.academicBoard || value.customBoardName || value.academicStream || value.scienceCombination || value.academicPreparation || value.competitiveExamId) return "Skill-based courses cannot use school or competitive-exam fields";
  return null;
}

export function compatibleLegacyCourseType(category: CourseCategoryType, examCode?: string | null) {
  if (category === "ACADEMIC") return "SCHOOL" as const;
  if (category === "SKILL_BASED") return "SKILL" as const;
  const code = examCode?.toUpperCase() ?? "";
  if (code.startsWith("JEE")) return "JEE" as const;
  if (code.startsWith("NEET")) return "NEET" as const;
  if (code.startsWith("CUET")) return "CUET" as const;
  if (code === "NDA") return "NDA" as const;
  if (code === "CA_FOUNDATION") return "CA_FOUNDATION" as const;
  return "OTHER" as const;
}

export function slugifyCourseTitle(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}
