export const competitiveExamCatalog = [
  ["JEE_MAIN", "JEE Main"], ["JEE_ADVANCED", "JEE Advanced"], ["NEET_UG", "NEET UG"], ["CUET_UG", "CUET UG"], ["NDA", "NDA"], ["CLAT", "CLAT"], ["AILET", "AILET"], ["IPMAT", "IPMAT"], ["NCHM_JEE", "NCHM JEE"], ["NIFT", "NIFT"], ["NID_DAT", "NID DAT"], ["UCEED", "UCEED"], ["CA_FOUNDATION", "CA Foundation"], ["CMA_FOUNDATION", "CMA Foundation"], ["CSEET", "CSEET"], ["SSC_CHSL", "SSC CHSL"], ["OTHER", "Other / Custom"],
] as const;

export const skillCategoryCatalog = [
  ["ARTIFICIAL_INTELLIGENCE", "Artificial Intelligence"], ["GENERATIVE_AI", "Generative AI"], ["PYTHON", "Python"], ["DATA_ANALYTICS", "Data Analytics"], ["POWER_BI", "Power BI"], ["DIGITAL_MARKETING", "Digital Marketing"], ["SEO", "SEO"], ["SOCIAL_MEDIA_MARKETING", "Social Media Marketing"], ["WEB_DEVELOPMENT", "Web Development"], ["CODING", "Coding"], ["VIDEO_EDITING", "Video Editing"], ["GRAPHIC_DESIGN", "Graphic Design"], ["TALLY_GST", "Tally / GST"], ["MS_OFFICE", "MS Office"], ["SPOKEN_ENGLISH", "Spoken English"], ["COMMUNICATION_SKILLS", "Communication Skills"], ["OTHER", "Other / Custom"],
] as const;

export const specializationCatalog = [
  ["JEE_PHYSICS", "JEE Physics"], ["NEET_PHYSICS", "NEET Physics"], ["BOARD_PHYSICS", "Board Physics"], ["MATHEMATICS", "Mathematics"], ["FOUNDATION_MATHEMATICS", "Foundation Mathematics"], ["ORGANIC_CHEMISTRY", "Organic Chemistry"], ["PHYSICAL_CHEMISTRY", "Physical Chemistry"], ["ACCOUNTS", "Accounts"], ["ECONOMICS", "Economics"], ["COMPUTER_SCIENCE", "Computer Science"], ["PYTHON", "Python"], ["ARTIFICIAL_INTELLIGENCE", "Artificial Intelligence"], ["DIGITAL_MARKETING", "Digital Marketing"],
] as const;

export const academicSubjectCatalog = [
  ["ENGLISH", "English"], ["HINDI", "Hindi"], ["MATHEMATICS", "Mathematics"], ["SCIENCE", "Science"], ["ENVIRONMENTAL_STUDIES", "Environmental Studies"], ["SOCIAL_SCIENCE", "Social Science"], ["PHYSICS", "Physics"], ["CHEMISTRY", "Chemistry"], ["BIOLOGY", "Biology"], ["COMPUTER_SCIENCE", "Computer Science"], ["INFORMATICS_PRACTICES", "Informatics Practices"], ["PHYSICAL_EDUCATION", "Physical Education"], ["ACCOUNTANCY", "Accountancy"], ["BUSINESS_STUDIES", "Business Studies"], ["ECONOMICS", "Economics"], ["HISTORY", "History"], ["GEOGRAPHY", "Geography"], ["POLITICAL_SCIENCE", "Political Science"], ["PSYCHOLOGY", "Psychology"], ["SOCIOLOGY", "Sociology"], ["HOME_SCIENCE", "Home Science"], ["FINE_ARTS", "Fine Arts"], ["MUSIC", "Music"], ["LEGAL_STUDIES", "Legal Studies"], ["ENTREPRENEURSHIP", "Entrepreneurship"], ["APPLIED_MATHEMATICS", "Applied Mathematics"],
] as const;

type CatalogDb = {
  competitiveExam: { createMany(args: { data: Array<{ organizationId: string; code: string; name: string }>; skipDuplicates: boolean }): Promise<unknown> };
  skillCategory: { createMany(args: { data: Array<{ organizationId: string; code: string; name: string }>; skipDuplicates: boolean }): Promise<unknown> };
  specialization: { createMany(args: { data: Array<{ organizationId: string; code: string; name: string }>; skipDuplicates: boolean }): Promise<unknown> };
  subject: { createMany(args: { data: Array<{ organizationId: string; code: string; name: string }>; skipDuplicates: boolean }): Promise<unknown> };
};

export async function ensureEducationCatalogs(db: CatalogDb, organizationId: string) {
  await Promise.all([
    db.competitiveExam.createMany({ data: competitiveExamCatalog.map(([code, name]) => ({ organizationId, code, name })), skipDuplicates: true }),
    db.skillCategory.createMany({ data: skillCategoryCatalog.map(([code, name]) => ({ organizationId, code, name })), skipDuplicates: true }),
    db.specialization.createMany({ data: specializationCatalog.map(([code, name]) => ({ organizationId, code, name })), skipDuplicates: true }),
    db.subject.createMany({ data: academicSubjectCatalog.map(([code, name]) => ({ organizationId, code, name })), skipDuplicates: true }),
  ]);
}
