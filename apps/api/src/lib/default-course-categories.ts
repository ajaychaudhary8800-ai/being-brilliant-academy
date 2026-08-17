export const defaultCourseCategories = [
  { name: "SCHOOL", slug: "school" },
  { name: "JEE", slug: "jee" },
  { name: "NEET", slug: "neet" },
  { name: "CUET", slug: "cuet" },
  { name: "NDA", slug: "nda" },
  { name: "FOUNDATION", slug: "foundation" },
  { name: "COMMERCE", slug: "commerce" },
  { name: "SKILL COURSE", slug: "skill-course" },
  { name: "OTHER", slug: "other" },
] as const;

type CategoryWriter = {
  category: {
    createMany(args: {
      data: Array<{ organizationId: string; name: string; slug: string }>;
      skipDuplicates: boolean;
    }): Promise<unknown>;
  };
};

export function ensureDefaultCourseCategories(db: CategoryWriter, organizationId: string) {
  return db.category.createMany({
    data: defaultCourseCategories.map((category) => ({ organizationId, ...category })),
    skipDuplicates: true,
  });
}
