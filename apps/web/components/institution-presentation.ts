export type InstitutionMode = "SCHOOL" | "COACHING" | "GENERAL";

export type InstitutionPresentation = {
  mode: InstitutionMode;
  institution: string;
  overviewTitle: string;
  singular: string;
  plural: string;
  course: string;
  courses: string;
  educators: string;
  assessments: string;
  learning: string;
  select: string;
  add: string;
};

export function institutionPresentation(type?: string, custom?: string | null): InstitutionPresentation {
  if (type === "SECTION") return {
    mode: "SCHOOL", institution: "School", overviewTitle: "School Overview", singular: "Section", plural: "Sections",
    course: "Class", courses: "Classes", educators: "Teachers", assessments: "Examinations", learning: "Digital Learning",
    select: "Select Section", add: "Add Section",
  };
  if (type === "BATCH") return {
    mode: "COACHING", institution: "Academy", overviewTitle: "Academy Overview", singular: "Batch", plural: "Batches",
    course: "Course", courses: "Courses & Programs", educators: "Faculty", assessments: "Tests & Assessments", learning: "Learning Resources",
    select: "Select Batch", add: "Add Batch",
  };
  const singular = type === "CUSTOM" && custom?.trim() ? custom.trim() : type === "GROUP" ? "Group" : "Batch";
  const plural = singular.endsWith("s") ? singular : `${singular}s`;
  return {
    mode: "GENERAL", institution: "Institution", overviewTitle: "Institution Overview", singular, plural,
    course: "Course", courses: "Courses", educators: "Teachers & Faculty", assessments: "Assessments", learning: "Learning Resources",
    select: `Select ${singular}`, add: `Add ${singular}`,
  };
}
