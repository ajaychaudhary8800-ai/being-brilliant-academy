import assert from "node:assert/strict";
import test from "node:test";
import { academicSubjectCatalog, competitiveExamCatalog, ensureEducationCatalogs, skillCategoryCatalog, specializationCatalog } from "./education-catalogs.js";

test("education catalog provisioning is tenant-scoped, configurable and idempotent", async () => {
  const calls: Array<{ model: string; data: Array<{ organizationId: string; code: string; name: string }>; skipDuplicates: boolean }> = [];
  const model = (name: string) => ({ createMany: async ({ data, skipDuplicates }: { data: Array<{ organizationId: string; code: string; name: string }>; skipDuplicates: boolean }) => { calls.push({ model: name, data, skipDuplicates }); } });
  await ensureEducationCatalogs({ competitiveExam: model("exam"), skillCategory: model("skill"), specialization: model("specialization"), subject: model("subject") }, "organization-a");
  assert.equal(calls.length, 4);
  assert.equal(calls.every(call => call.skipDuplicates && call.data.every(row => row.organizationId === "organization-a")), true);
  assert.equal(calls.find(call => call.model === "exam")?.data.length, competitiveExamCatalog.length);
  assert.equal(calls.find(call => call.model === "skill")?.data.length, skillCategoryCatalog.length);
  assert.equal(calls.find(call => call.model === "specialization")?.data.length, specializationCatalog.length);
  assert.equal(calls.find(call => call.model === "subject")?.data.length, academicSubjectCatalog.length);
});
